const form = document.querySelector("#uploadForm");
const input = document.querySelector("#fileInput");
const queue = document.querySelector("#queue");
const statusLine = document.querySelector("#statusLine");
const connectLink = document.querySelector("#connectLink");

let isConnected = false;

refreshStatus();

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

async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    isConnected = status.connected;

    if (!status.configured) {
      setStatus(`Configure o .env: ${status.missingEnv.join(", ")}`, "error");
      connectLink.textContent = "Configurar";
      connectLink.hidden = false;
      return;
    }

    if (status.connected) {
      setStatus(`Pronto para envio. Os arquivos vao para "${status.folder}". Limite: ${status.maxFileMb} MB.`, "ok");
      connectLink.textContent = "Admin";
      connectLink.classList.add("connected");
      connectLink.hidden = true;
      return;
    }

    connectLink.hidden = !status.adminLoginUrl;
    if (status.adminLoginUrl) {
      connectLink.href = status.adminLoginUrl;
      connectLink.textContent = "Ativar";
    }
    setStatus("Envio ainda nao ativado. O responsavel precisa conectar a conta Microsoft uma unica vez.", "");
  } catch {
    setStatus("Nao consegui verificar o servidor.", "error");
  }
}

async function uploadFiles(files) {
  if (!isConnected) {
    setStatus("O envio ainda nao foi ativado pelo responsavel.", "error");
    return;
  }

  const selected = Array.from(files);
  const rows = selected.map(addFileRow);
  const formData = new FormData();

  for (const file of selected) {
    formData.append("files", file);
  }

  setStatus("Enviando arquivos...", "");

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Falha no envio.");
    }

    rows.forEach((row, index) => {
      const result = data.files[index];
      updateFileRow(row, "Enviado", "success", result?.webUrl);
    });

    setStatus("Upload concluido.", "ok");
    input.value = "";
  } catch (error) {
    rows.forEach((row) => updateFileRow(row, error.message, "error"));
    setStatus(error.message, "error");
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
