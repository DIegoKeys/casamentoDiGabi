const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { URL, URLSearchParams } = require("url");

loadEnv();

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(process.cwd(), "public");
const uploadDir = path.join(process.cwd(), "uploads");
const tokenPath = path.join(process.cwd(), ".token-cache.json");
const oneDriveFolder = process.env.ONEDRIVE_FOLDER || "Uploads do Site";
const oneDriveShareUrl = process.env.ONEDRIVE_SHARE_URL || "";
const adminKey = process.env.ADMIN_KEY || "";
const maxFileMb = Number(process.env.MAX_FILE_MB || 500);
const maxBodyBytes = maxFileMb * 1024 * 1024;
const scopes = ["Files.ReadWrite", "offline_access", "User.Read"];

const requiredEnv = [
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_REDIRECT_URI",
  "SESSION_SECRET"
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, getStatus(false));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, getStatus(await hasRefreshToken()));
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/config") {
      requireAdminKey(req);
      sendJson(res, 200, getAdminConfig(req));
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/login") {
      await handleLogin(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/callback") {
      await handleCallback(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/upload") {
      await handleUpload(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, url.pathname);
      return;
    }

    sendJson(res, 404, { error: "Rota nao encontrada." });
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Erro inesperado."
    });
  }
});

server.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});

function getStatus(connected) {
  const missingEnv = requiredEnv.filter((name) => !process.env[name]);

  return {
    ok: true,
    configured: missingEnv.length === 0,
    missingEnv,
    connected,
    folder: oneDriveShareUrl ? "Pasta compartilhada do OneDrive" : oneDriveFolder,
    adminLoginUrl: adminKey ? null : "/auth/login",
    needsAdminActivation: !connected,
    maxFileMb
  };
}

function getAdminConfig(req) {
  return {
    configured: requiredEnv.every((name) => Boolean(process.env[name])),
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || null,
    expectedRenderRedirectUri: `https://${req.headers.host}/auth/callback`,
    hasClientId: Boolean(process.env.MICROSOFT_CLIENT_ID),
    hasClientSecret: Boolean(process.env.MICROSOFT_CLIENT_SECRET),
    hasOneDriveShareUrl: Boolean(oneDriveShareUrl),
    hasAdminKey: Boolean(adminKey)
  };
}

async function handleLogin(req, res) {
  ensureConfigured();
  requireAdminKey(req);

  const state = signState(crypto.randomBytes(24).toString("hex"));
  const authUrl = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
  authUrl.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", process.env.MICROSOFT_REDIRECT_URI);
  authUrl.searchParams.set("response_mode", "query");
  authUrl.searchParams.set("scope", scopes.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  res.writeHead(302, {
    Location: authUrl.toString()
  });
  res.end();
}

async function handleCallback(req, res, url) {
  ensureConfigured();

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state || !verifySignedState(state)) {
    throw httpError(400, "Retorno de login invalido.");
  }

  const token = await exchangeToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI
  });

  await saveToken(token);

  res.writeHead(302, {
    Location: "/?connected=1"
  });
  res.end();
}

async function handleUpload(req, res) {
  ensureConfigured();

  if (!req.headers["content-type"]?.includes("multipart/form-data")) {
    throw httpError(400, "Envio invalido.");
  }

  const body = await readRequestBody(req, maxBodyBytes + 1024 * 1024);
  const files = parseMultipartFiles(body, req.headers["content-type"]);

  if (files.length === 0) {
    throw httpError(400, "Nenhum arquivo recebido.");
  }

  const accessToken = await getAccessToken();
  const uploadTarget = await resolveUploadTarget(accessToken);
  await fsp.mkdir(uploadDir, { recursive: true });

  const results = [];
  const tempFiles = [];

  try {
    for (const file of files) {
      if (!file.mimeType.startsWith("image/") && !file.mimeType.startsWith("video/")) {
        throw httpError(400, "Envie apenas imagens ou videos.");
      }

      const tempPath = path.join(uploadDir, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.name)}`);
      tempFiles.push(tempPath);
      await fsp.writeFile(tempPath, file.content);

      const destinationName = buildSafeOneDriveName(file.name);
      const item = await uploadFileToOneDrive(accessToken, tempPath, uploadTarget, destinationName, file.content.length);

      results.push({
        name: file.name,
        size: file.content.length,
        webUrl: item.webUrl
      });
    }
  } finally {
    await Promise.all(tempFiles.map((file) => fsp.rm(file, { force: true })));
  }

  sendJson(res, 200, { files: results });
}

async function getAccessToken() {
  const token = await readToken();

  if (!token.refresh_token) {
    throw httpError(401, "Conecte sua conta Microsoft antes de enviar arquivos.");
  }

  const refreshed = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI
  });

  await saveToken({
    ...token,
    ...refreshed,
    refresh_token: refreshed.refresh_token || token.refresh_token
  });

  return refreshed.access_token;
}

async function exchangeToken(extraParams) {
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    scope: scopes.join(" "),
    ...extraParams
  });

  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await response.json();

  if (!response.ok) {
    throw httpError(response.status, data.error_description || data.error || "Falha na autenticacao Microsoft.");
  }

  return data;
}

async function resolveUploadTarget(accessToken) {
  if (!oneDriveShareUrl) {
    return {
      type: "path",
      folderPath: oneDriveFolder
    };
  }

  const shareId = encodeSharingUrl(oneDriveShareUrl);
  const response = await graphFetch(
    accessToken,
    `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`
  );
  const item = await response.json();
  const driveId = item.parentReference?.driveId || item.remoteItem?.parentReference?.driveId;
  const itemId = item.id || item.remoteItem?.id;

  if (!driveId || !itemId) {
    throw httpError(400, "Nao consegui identificar a pasta compartilhada do OneDrive.");
  }

  return {
    type: "sharedFolder",
    driveId,
    itemId
  };
}

async function uploadFileToOneDrive(accessToken, localPath, uploadTarget, destinationName, fileSize) {
  if (fileSize <= 4 * 1024 * 1024) {
    const bytes = await fsp.readFile(localPath);
    const uploadUrl = buildUploadUrl(uploadTarget, destinationName, "content");
    const response = await graphFetch(
      accessToken,
      uploadUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream"
        },
        body: bytes
      }
    );

    return response.json();
  }

  return uploadLargeFileToOneDrive(accessToken, localPath, uploadTarget, destinationName, fileSize);
}

async function uploadLargeFileToOneDrive(accessToken, localPath, uploadTarget, destinationName, fileSize) {
  const uploadUrl = buildUploadUrl(uploadTarget, destinationName, "createUploadSession");
  const sessionResponse = await graphFetch(
    accessToken,
    uploadUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        item: {
          "@microsoft.graph.conflictBehavior": "rename"
        }
      })
    }
  );

  const session = await sessionResponse.json();
  const chunkSize = 10 * 1024 * 1024;
  const handle = await fsp.open(localPath, "r");

  try {
    let start = 0;

    while (start < fileSize) {
      const end = Math.min(start + chunkSize, fileSize) - 1;
      const length = end - start + 1;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);

      const response = await fetch(session.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(length),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`
        },
        body: buffer
      });

      if (!response.ok) {
        const text = await response.text();
        throw httpError(response.status, `Falha no envio para o OneDrive: ${text}`);
      }

      if (response.status === 201 || response.status === 200) {
        return response.json();
      }

      start = end + 1;
    }
  } finally {
    await handle.close();
  }

  throw httpError(500, "O upload terminou sem resposta final do OneDrive.");
}

async function graphFetch(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw httpError(response.status, `Erro do Microsoft Graph: ${text}`);
  }

  return response;
}

function parseMultipartFiles(body, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];

  if (!boundary) {
    throw httpError(400, "Boundary do upload nao encontrado.");
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const files = [];
  let position = body.indexOf(delimiter) + delimiter.length;

  while (position > delimiter.length - 1 && position < body.length) {
    if (body[position] === 45 && body[position + 1] === 45) break;
    if (body[position] === 13 && body[position + 1] === 10) position += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), position);
    if (headerEnd === -1) break;

    const headers = body.slice(position, headerEnd).toString("utf8");
    const nextBoundary = body.indexOf(delimiter, headerEnd + 4);
    if (nextBoundary === -1) break;

    const disposition = headers.match(/content-disposition:[^\r\n]+/i)?.[0] || "";
    const fileName = disposition.match(/filename="([^"]*)"/i)?.[1];
    const mimeType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "application/octet-stream";

    if (fileName) {
      const contentEnd = body[nextBoundary - 2] === 13 && body[nextBoundary - 1] === 10 ? nextBoundary - 2 : nextBoundary;
      files.push({
        name: path.basename(fileName),
        mimeType,
        content: body.slice(headerEnd + 4, contentEnd)
      });
    }

    position = nextBoundary + delimiter.length;
  }

  return files;
}

async function readRequestBody(req, maxBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;

    if (total > maxBytes) {
      throw httpError(413, `Arquivo maior que o limite de ${maxFileMb} MB.`);
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function serveStatic(res, requestedPath) {
  const cleanPath = requestedPath === "/" ? "/index.html" : requestedPath;
  const filePath = path.normalize(path.join(publicDir, cleanPath));

  if (!filePath.startsWith(publicDir)) {
    throw httpError(403, "Acesso negado.");
  }

  try {
    const content = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": getContentType(filePath)
    });
    res.end(content);
  } catch {
    throw httpError(404, "Arquivo nao encontrado.");
  }
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
  }[extension] || "application/octet-stream";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function ensureConfigured() {
  const missingEnv = requiredEnv.filter((name) => !process.env[name]);

  if (missingEnv.length > 0) {
    throw httpError(500, `Configure o arquivo .env: ${missingEnv.join(", ")}`);
  }
}

function requireAdminKey(req) {
  if (!adminKey) return;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const providedKey = url.searchParams.get("key") || "";

  if (!safeCompare(providedKey, adminKey)) {
    throw httpError(403, "Acesso administrativo negado.");
  }
}

async function hasRefreshToken() {
  const token = await readToken();
  return Boolean(token.refresh_token);
}

async function readToken() {
  try {
    return JSON.parse(await fsp.readFile(tokenPath, "utf8"));
  } catch {
    return {};
  }
}

async function saveToken(token) {
  await fsp.writeFile(tokenPath, JSON.stringify(token, null, 2), "utf8");
}

function buildSafeOneDriveName(originalName) {
  const parsed = path.parse(originalName);
  const base = parsed.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "arquivo";

  const ext = parsed.ext.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").slice(0, 16);
  return `${base}-${Date.now()}${ext}`;
}

function encodeOneDrivePath(destinationPath) {
  return destinationPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function buildUploadUrl(uploadTarget, destinationName, action) {
  const encodedName = encodeOneDrivePath(destinationName);

  if (uploadTarget.type === "sharedFolder") {
    return `https://graph.microsoft.com/v1.0/drives/${uploadTarget.driveId}/items/${uploadTarget.itemId}:/${encodedName}:/${action}`;
  }

  const encodedPath = encodeOneDrivePath(`${uploadTarget.folderPath}/${destinationName}`);
  return `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/${action}`;
}

function encodeSharingUrl(sharingUrl) {
  const encoded = Buffer.from(sharingUrl)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\//g, "_")
    .replace(/\+/g, "-");

  return `u!${encoded}`;
}

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function signState(state) {
  const secret = process.env.SESSION_SECRET || "dev-only-secret";
  const signature = crypto.createHmac("sha256", secret).update(state).digest("hex");
  return `${state}.${signature}`;
}

function verifySignedState(signedState) {
  const separator = signedState.lastIndexOf(".");
  if (separator === -1) return false;

  const state = signedState.slice(0, separator);
  const signature = signedState.slice(separator + 1);
  const expected = signState(state).slice(separator + 1);

  if (signature.length !== expected.length) return false;

  return safeCompare(signature, expected);
}

function safeCompare(value, expected) {
  if (value.length !== expected.length) return false;

  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
