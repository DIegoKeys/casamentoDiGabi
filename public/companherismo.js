const audio = document.querySelector("#secretAudio");
const soundButton = document.querySelector("#soundButton");
const form = document.querySelector("#riddleForm");
const answerInput = document.querySelector("#answerInput");
const message = document.querySelector("#secretMessage");

startAudio();

soundButton.addEventListener("click", async () => {
  await playAudio();
  soundButton.hidden = true;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (normalizeAnswer(answerInput.value) === "ela vai voltar") {
    message.className = "secret-message ok";
    message.textContent = 'Va ate os noivos e diga: "me de o que esta no seu bolso, Diego, pois ela vai voltar"';
    return;
  }

  message.className = "secret-message error";
  message.textContent = "Ainda nao. Tente lembrar a musica certinha.";
});

async function startAudio() {
  try {
    await playAudio();
  } catch {
    soundButton.hidden = false;
  }
}

async function playAudio() {
  audio.currentTime = 0;
  await audio.play();
}

function normalizeAnswer(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
