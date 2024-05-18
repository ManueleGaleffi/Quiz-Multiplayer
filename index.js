const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 3000;

let questions;
let players = {};
let currentQuestionIndex = {};
let gameStarted = {};
let selectedQuestions = {}; // Aggiungi un oggetto per memorizzare le domande selezionate per ogni stanza

fs.readFile("questions.json", "utf8", (err, data) => {
  if (err) {
    console.error("Errore nella lettura del file delle domande:", err);
    return;
  }
  questions = JSON.parse(data);
});

// Funzione per scegliere 10 domande casualmente
function getRandomQuestions() {
  const shuffled = questions.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 10);
}

function getCurrentQuestion(roomNumber) {
  return selectedQuestions[roomNumber][currentQuestionIndex[roomNumber]];
}

function startGame(roomNumber) {
  console.log(`Starting game for room ${roomNumber}...`);
  gameStarted[roomNumber] = true;
  currentQuestionIndex[roomNumber] = 0;
  selectedQuestions[roomNumber] = getRandomQuestions(); // Seleziona 10 domande casuali per questa stanza

  Object.keys(players).forEach(playerID => {
    if (players[playerID].roomNumber === roomNumber) {
      players[playerID].score = 0;
      players[playerID].answered = false; // Aggiungi la proprietà answered
    }
  });
  io.to(roomNumber).emit("gameStarted");
  sendQuestion(roomNumber);
  updateScores(roomNumber);
}

function restartGame(roomNumber) {
  console.log(`Restarting game for room ${roomNumber}...`);
  gameStarted[roomNumber] = false;
  currentQuestionIndex[roomNumber] = 0;
  selectedQuestions[roomNumber] = getRandomQuestions(); // Seleziona 10 nuove domande casuali per questa stanza

  Object.keys(players).forEach(playerID => {
    if (players[playerID].roomNumber === roomNumber) {
      players[playerID].score = 0;
      players[playerID].answered = false; // Aggiungi la proprietà answered
    }
  });
  io.to(roomNumber).emit("restartGame");
  startGame(roomNumber);
}

function sendQuestion(roomNumber) {
  const question = getCurrentQuestion(roomNumber);
  io.to(roomNumber).emit("question", question);

  // Reset answered property per tutti i giocatori nella stanza
  Object.keys(players).forEach(playerID => {
    if (players[playerID].roomNumber === roomNumber) {
      players[playerID].answered = false;
    }
  });

  updateScores(roomNumber);
}

function updateScores(roomNumber) {
  const playersInRoom = Object.values(players).filter(player => player.roomNumber === roomNumber);
  io.to(roomNumber).emit("updateScores", playersInRoom);
}

function updateScoresAndSendQuestion(roomNumber) {
  updateScores(roomNumber);
  if (currentQuestionIndex[roomNumber] < selectedQuestions[roomNumber].length) {
    setTimeout(() => {
      sendQuestion(roomNumber);
    }, 2000); // Delay di 2 secondi
  } else {
    endGame(roomNumber);
  }
}

function endGame(roomNumber) {
  io.to(roomNumber).emit("gameEnded", { players, roomNumber });

  // Determina il vincitore
  const playersInRoom = Object.entries(players).filter(([playerID, player]) => player.roomNumber === roomNumber);
  if (playersInRoom.length !== 2) return; // Should only happen if there are exactly 2 players
  
  const [player1ID, player1] = playersInRoom[0];
  const [player2ID, player2] = playersInRoom[1];

  let resultMessagePlayer1;
  let resultMessagePlayer2;

  if (player1.score > player2.score) {
    resultMessagePlayer1 = "Hai vinto!";
    resultMessagePlayer2 = "Hai perso!";
  } else if (player1.score < player2.score) {
    resultMessagePlayer1 = "Hai perso!";
    resultMessagePlayer2 = "Hai vinto!";
  } else {
    resultMessagePlayer1 = resultMessagePlayer2 = "Hai pareggiato!";
  }

  io.to(player1ID).emit("gameResult", resultMessagePlayer1);
  io.to(player2ID).emit("gameResult", resultMessagePlayer2);

  updateScores(roomNumber);
  // Non resettare l'intero oggetto players, solo i giocatori della stanza
  Object.keys(players).forEach(playerID => {
    if (players[playerID].roomNumber === roomNumber) {
      delete players[playerID];
    }
  });

  // Resetta lo stato della stanza
  gameStarted[roomNumber] = false;
  currentQuestionIndex[roomNumber] = 0;
  selectedQuestions[roomNumber] = [];
}

io.on("connection", (socket) => {
  console.log("Nuova connessione: " + socket.id);

  socket.on("joinRoom", (data) => {
    const { username, roomNumber } = data;
    socket.join(roomNumber);
    players[socket.id] = { username, roomNumber, score: 0, answered: false };
    console.log(`Player joined: ${socket.id}, Room: ${roomNumber}, Username: ${username}`);
    
    const playersInRoom = Object.values(players).filter(player => player.roomNumber === roomNumber);
    if (playersInRoom.length === 2 && !gameStarted[roomNumber]) {
      startGame(roomNumber);
    }
  });

  socket.on("answer", (answer) => {
    const player = players[socket.id];
    if (!player) {
      console.error(`Player with ID ${socket.id} not found`);
      return;
    }

    const { roomNumber } = player;

    // Se il giocatore ha già risposto a questa domanda, ignora
    if (player.answered) {
      console.log(`Player ${socket.id} has already answered.`);
      return;
    }

    const question = getCurrentQuestion(roomNumber);
    if (question.correctAnswer === answer) {
      players[socket.id].score++;
    } else {
      players[socket.id].score--; // Togli un punto in caso di risposta sbagliata
    }
    players[socket.id].answered = true; // Imposta la proprietà answered a true dopo aver risposto

    currentQuestionIndex[roomNumber]++;
    updateScoresAndSendQuestion(roomNumber);
  });

  socket.on("disconnect", () => {
    console.log("Disconnessione: " + socket.id);
    const player = players[socket.id];
    if (!player) {
      console.error(`Player with ID ${socket.id} not found on disconnect`);
      return;
    }

    const { roomNumber } = player;
    console.log(`Player disconnected: ${socket.id}, Room: ${roomNumber}`);
    delete players[socket.id];
    const playersInRoom = Object.values(players).filter(player => player.roomNumber === roomNumber);
    if (gameStarted[roomNumber] && playersInRoom.length < 2) {
      endGame(roomNumber);
    }
  });
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

server.listen(PORT, () => {
  console.log("Server listening on port " + PORT);
});
