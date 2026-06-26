const form = document.querySelector("#uploadForm");
const input = document.querySelector("#fileInput");
const queue = document.querySelector("#queue");
const statusLine = document.querySelector("#statusLine");
const connectLink = document.querySelector("#connectLink");
const folderLink = document.querySelector("#folderLink");
const uploadType = document.body.dataset.uploadType || "wedding";

let isConnected = false;
let chunkSize = 5 * 1024 * 1024;

refreshStatus();

if (form && input) {
  form.addEventListener("dragenter", () => form.classList.add("dragging"));
  form.addEventListener("dragover", (event) => {
    event.preventDefault();
    form.classList.add("dragging");
  });
  form.addEventListener("dragleave", () => form.classList.remove("dragging"));
  form.addEventListener("drop", () => form.classList.remove("dragging"));

  input.addEventListener("change", () => {
    if (input.files.length > 0) {
      uploadFiles(input.files);
    }
  });
}

async function refreshStatus() {
  if (!statusLine) return;

  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    isConnected = status.connected;
    chunkSize = Number(status.chunkSize || chunkSize);

    if (!status.configured) {
      setStatus(`Configure o .env: ${status.missingEnv.join(", ")}`, "error");
      if (connectLink) {
        connectLink.textContent = "Configurar";
        connectLink.hidden = false;
      }
      return;
    }

    if (status.connected) {
      const folder = uploadType === "quest" ? status.questFolder : status.folder;
      const folderUrl = uploadType === "quest" ? status.questFolderUrl : status.folderUrl;
      const readyMessage = form
        ? `Pronto para envio. Destino: ${folder}. Limite: ${status.maxFileMb} MB.`
        : "Envio pronto.";

      setStatus(readyMessage, "ok");
      updateFolderLink(folderUrl);
      if (connectLink) {
        connectLink.textContent = "Admin";
        connectLink.classList.add("connected");
        connectLink.hidden = true;
      }
      return;
    }

    if (connectLink) {
      connectLink.hidden = !status.adminLoginUrl;
      if (status.adminLoginUrl) {
        connectLink.href = status.adminLoginUrl;
        connectLink.textContent = "Ativar";
      }
    }
    setStatus("Envio ainda nao ativado. O responsavel precisa conectar a conta Microsoft uma unica vez.", "");
    updateFolderLink(null);
  } catch {
    setStatus("Nao consegui verificar o servidor.", "error");
    updateFolderLink(null);
  }
}

function updateFolderLink(url) {
  if (!folderLink) return;

  folderLink.hidden = !url;
  if (url) {
    folderLink.href = url;
  }
}

async function uploadFiles(files) {
  if (!isConnected) {
    setStatus("O envio ainda nao foi ativado pelo responsavel.", "error");
    return;
  }

  const selected = Array.from(files);
  const rows = selected.map(addFileRow);

  setStatus("Enviando arquivos...", "");

  try {
    for (let index = 0; index < selected.length; index += 1) {
      await uploadFileInChunks(selected[index], rows[index]);
    }

    setStatus("Upload concluido.", "ok");
    input.value = "";
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function uploadFileInChunks(file, row) {
  updateFileRow(row, "Preparando", "");

  const startResponse = await fetch("/api/uploads/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: uploadType,
      name: file.name,
      size: file.size,
      mimeType: file.type
    })
  });
  const startData = await startResponse.json();

  if (!startResponse.ok) {
    updateFileRow(row, startData.error || "Falha ao iniciar", "error");
    throw new Error(startData.error || "Falha ao iniciar upload.");
  }

  let offset = 0;
  const uploadChunkSize = Number(startData.chunkSize || chunkSize);

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + uploadChunkSize);
    const response = await fetch(`/api/uploads/${startData.uploadId}/chunk`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Chunk-Start": String(offset),
        "X-File-Size": String(file.size)
      },
      body: chunk
    });
    const data = await response.json();

    if (!response.ok) {
      updateFileRow(row, data.error || "Falha no envio", "error");
      throw new Error(data.error || "Falha no envio.");
    }

    offset += chunk.size;
    updateFileRow(row, `${Math.floor((offset / file.size) * 100)}%`, "");

    if (data.done) {
      updateFileRow(row, "Enviado", "success", data.file?.webUrl);
      return;
    }
  }
}

function addFileRow(file) {
  const row = document.createElement("div");
  row.className = "file-row";
  row.innerHTML = `
    <div>
      <div class="file-name"></div>
      <div class="file-meta"></div>
    </div>
    <div class="file-state">Aguardando</div>
  `;

  row.querySelector(".file-name").textContent = file.name;
  row.querySelector(".file-meta").textContent = formatBytes(file.size);
  queue.prepend(row);
  return row;
}

function updateFileRow(row, message, type, url) {
  const state = row.querySelector(".file-state");
  state.textContent = message;
  state.className = `file-state ${type}`;

  if (url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Abrir";
    state.textContent = "";
    state.append(link);
  }
}

function setStatus(message, type) {
  statusLine.textContent = message;
  statusLine.className = `status-line ${type}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
