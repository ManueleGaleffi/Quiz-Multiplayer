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

fs.readFile("questions.json", "utf8", (err, data) => {
  if (err) {
    console.error("Errore nella lettura del file delle domande:", err);
    return;
  }
  questions = JSON.parse(data);
});

function getCurrentQuestion(roomNumber) {
  return questions[currentQuestionIndex[roomNumber]];
}

function startGame(roomNumber) {
  console.log(`Starting game for room ${roomNumber}...`);
  gameStarted[roomNumber] = true;
  currentQuestionIndex[roomNumber] = 0;
  Object.keys(players).forEach(playerID => {
    if (players[playerID].roomNumber === roomNumber) {
      players[playerID].score = 0;
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
  Object.keys(players).forEach(playerID => {
    if (players[playerID].roomNumber === roomNumber) {
      players[playerID].score = 0;
    }
  });
  io.to(roomNumber).emit("restartGame");
  startGame(roomNumber);
}

function sendQuestion(roomNumber) {
  const question = getCurrentQuestion(roomNumber);
  io.to(roomNumber).emit("question", question);
  updateScores(roomNumber);
}

function updateScores(roomNumber) {
  const playersInRoom = Object.values(players).filter(player => player.roomNumber === roomNumber);
  io.to(roomNumber).emit("updateScores", playersInRoom);
}

function endGame(roomNumber) {
  io.to(roomNumber).emit("gameEnded", { players, roomNumber });

  // Determina il vincitore
  let winnerID;
  let maxScore = -1;
  Object.entries(players).forEach(([playerID, player]) => {
    if (player.roomNumber === roomNumber && player.score > maxScore) {
      maxScore = player.score;
      winnerID = playerID;
    }
  });

  // Invia il risultato ai giocatori
  Object.entries(players).forEach(([playerID, player]) => {
    if (player.roomNumber === roomNumber) {
      if (playerID === winnerID) {
        io.to(playerID).emit("gameResult", "Hai vinto!");
      } else {
        io.to(playerID).emit("gameResult", "Hai perso!");
      }
    }
  });

  updateScores(roomNumber);
  players = {}; // Resetta i punteggi dei giocatori
}

io.on("connection", (socket) => {
  console.log("Nuova connessione: " + socket.id);

  socket.on("joinRoom", (data) => {
    const { username, roomNumber } = data;
    socket.join(roomNumber);
    players[socket.id] = { username, roomNumber, score: 0 };

    // Controlla se ci sono due giocatori nella stessa stanza
    const playersInRoom = Object.values(players).filter(player => player.roomNumber === roomNumber);
    if (playersInRoom.length === 2 && !gameStarted[roomNumber]) {
      startGame(roomNumber);
    }
  });

  socket.on("answer", (answer) => {
    const { roomNumber } = players[socket.id];
    const question = getCurrentQuestion(roomNumber);
    if (question.correctAnswer === answer) {
      players[socket.id].score++;
    } else {
      players[socket.id].score--; // Togli un punto in caso di risposta sbagliata
    }
    updateScores(roomNumber);
    currentQuestionIndex[roomNumber]++;
    if (currentQuestionIndex[roomNumber] < questions.length) {
      sendQuestion(roomNumber);
    } else {
      endGame(roomNumber);
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnessione: " + socket.id);
    if (players[socket.id]) {
      const { roomNumber } = players[socket.id];
      delete players[socket.id];
      const playersInRoom = Object.values(players).filter(player => player.roomNumber === roomNumber);
      if (gameStarted[roomNumber] && playersInRoom.length < 2) {
        endGame(roomNumber);
      }
    }
  });
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

server.listen(PORT, () => {
  console.log("Server listening on port " + PORT);
});
