// 🎵 Sound Effects
const clickSound = new Audio("https://assets.mixkit.co/sfx/preview/mixkit-select-click-1109.mp3");
const winSound = new Audio("https://assets.mixkit.co/sfx/preview/mixkit-achievement-bell-600.mp3");
const drawSound = new Audio("https://assets.mixkit.co/sfx/preview/mixkit-retro-game-notification-212.wav");

// 🎮 Elements
const playLocalBtn = document.getElementById('playLocalBtn');
const gameArea = document.getElementById('gameArea');
const setupArea = document.getElementById('setupArea');
const boardEl = document.getElementById('board');
const banner = document.getElementById('winnerBanner');
const turnDisplay = document.getElementById('turnDisplay');
const p1Input = document.getElementById('player1Name');
const p2Input = document.getElementById('player2Name');

let board = Array(9).fill(null);
let winner = null;
let currentPlayer = null;
let players = { X: 'Player 1', O: 'Player 2' };

// 🕹 Start Game
playLocalBtn.onclick = () => {
  const p1 = p1Input.value.trim() || "Player 1";
  const p2 = p2Input.value.trim() || "Player 2";
  players = { X: p1, O: p2 };

  setupArea.classList.add('hidden');
  gameArea.classList.remove('hidden');
  banner.classList.add('hidden');
  currentPlayer = 'X';
  board = Array(9).fill(null);
  winner = null;
  updateTurnDisplay();
  renderBoard();
};

function updateTurnDisplay() {
  turnDisplay.textContent = `${players[currentPlayer]}'s turn (${currentPlayer})`;
}

// 🎯 Render Board
function renderBoard() {
  boardEl.innerHTML = '';
  board.forEach((cell, i) => {
    const el = document.createElement('div');
    el.className = 'cell';
    el.textContent = cell || '';
    el.onclick = () => makeMove(i);
    boardEl.appendChild(el);
  });
}

// 🧩 Handle Move
function makeMove(i) {
  if (board[i] || winner) return;
  clickSound.play();
  board[i] = currentPlayer;
  if (checkWinner()) {
    winSound.play();
    showWinner(currentPlayer);
    return;
  }
  if (board.every(Boolean)) {
    drawSound.play();
    showWinner('draw');
    return;
  }
  currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
  updateTurnDisplay();
  renderBoard();
}

// 🏆 Check Winner
function checkWinner() {
  const combos = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (let [a,b,c] of combos) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      winner = board[a];
      highlightWinningCells([a,b,c]);
      return true;
    }
  }
  return false;
}

function highlightWinningCells(indices) {
  const cells = document.querySelectorAll('.cell');
  indices.forEach(i => {
    cells[i].style.background = 'linear-gradient(135deg, #10b981, #059669)';
  });
}

// 🥇 Show Winner Banner
function showWinner(result) {
  banner.classList.remove('hidden');
  if (result === 'draw') {
    banner.textContent = "🤝 It's a draw!";
  } else {
    banner.textContent = `🎉 ${players[result]} wins! 🎉`;
  }

  setTimeout(() => {
    banner.classList.add('hidden');
    setupArea.classList.remove('hidden');
    gameArea.classList.add('hidden');
  }, 3000);
}
