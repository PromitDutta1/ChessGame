/* =======================
   NEW GAME LOGIC (Menu + Online + AI)
   ======================= */
let board, game = new Chess();
let engine, engineReady = false, isAiThinking = false;
let gameMode = null;
let playerColor = "white";
let roomId = null;
let onlineTurn = "white";

document.getElementById("vsAI").onclick = () => startAIGame();
document.getElementById("online").onclick = () => document.getElementById("multiplayerMenu").classList.remove("hidden");

document.getElementById("quickMatch").onclick = () => quickMatch();
document.getElementById("createRoom").onclick = () => createRoom();
document.getElementById("joinRoomBtn").onclick = () => joinRoom();

function startAIGame(){
  gameMode = "ai";
  document.getElementById("controls").classList.remove("hidden");
  startBoard();
}

function quickMatch(){
  // Ensure db is accessible (from firebase.js or loader)
  const database = window.db || (window.firebase ? window.firebase.database : null);
  if(!database) return console.error("Database not loaded");

  const ref = database.ref("rooms/");
  ref.once("value", snap => {
    const rooms = snap.val() || {};

    for(let id in rooms){
      if(rooms[id].status === "waiting"){
        joinRoom(id);
        return;
      }
    }

    createRoom();
  });
}

function createRoom(){
  const database = window.db || (window.firebase ? window.firebase.database : null);
  roomId = Math.random().toString(36).substring(2,7).toUpperCase();
  
  database.ref("rooms/" + roomId).set({
    fen: game.fen(),
    turn: "white",
    status: "waiting"
  });

  alert("Room Created: " + roomId);
  playerColor = "white";
  gameMode = "online";
  startOnlineListener();
  startBoard();
}

function joinRoom(code){
  const database = window.db || (window.firebase ? window.firebase.database : null);
  roomId = code || document.getElementById("roomCode").value.toUpperCase();
  
  database.ref("rooms/" + roomId).once("value", snap =>{
    if(!snap.exists()){ alert("Room not found."); return; }

    playerColor = "black";
    database.ref("rooms/" + roomId).update({ status: "playing" });

    gameMode = "online";
    startOnlineListener();
    startBoard();
  })
}

function startOnlineListener(){
  const database = window.db || (window.firebase ? window.firebase.database : null);
  database.ref("rooms/" + roomId).on("value", snap =>{
    const data = snap.val();
    if(!data) return;

    if(data.fen !== game.fen()){
      game.load(data.fen);
      board.position(data.fen);
    }

    onlineTurn = data.turn;
  });
}

function startBoard(){
  document.getElementById("board").innerHTML = "";
  board = Chessboard("board", {
    draggable: true,
    position: game.fen(),
    onDrop: handleMove
  });
}

function handleMove(source, target){
  let move = game.move({ from: source, to: target, promotion: "q" });

  if(move === null) return "snapback";

  if(gameMode === "online"){
    if(playerColor !== onlineTurn){ game.undo(); return "snapback"; }

    const database = window.db || (window.firebase ? window.firebase.database : null);
    database.ref("rooms/" + roomId).update({
      fen: game.fen(),
      turn: (game.turn() === "w" ? "white" : "black")
    });
  }

  if(gameMode === "ai"){
    setTimeout(makeAiMove, 300);
  }

  playMoveSound(); // Added sound trigger
  checkGameEnd();
}

function ensureEngine(){
  if(engine && engineReady) return;
  engine = new Worker("https://cdn.jsdelivr.net/npm/stockfish.js");
  engineReady = true;
}

function makeAiMove(){
  ensureEngine();
  let aiDepth = document.getElementById("difficulty").value;
  let depth = aiDepth == 99 ? 30 : {1:8,2:12,3:16,4:20,5:24,6:28}[aiDepth];

  engine.postMessage("uci");
  engine.postMessage("position fen " + game.fen());
  engine.postMessage("go depth " + depth);

  engine.onmessage = e => {
    if(typeof e.data === 'string' && e.data.startsWith("bestmove")){
      let mv = e.data.split(" ")[1];
      game.move({from:mv.slice(0,2),to:mv.slice(2,4),promotion:"q"});
      board.position(game.fen());
      playMoveSound(); // Added sound trigger
      checkGameEnd();
    }
  };
}

function checkGameEnd(){
  if(!game.game_over()) return;

  let msg = game.in_checkmate() 
    ? (game.turn()==='w' ? "BLACK WINS!" : "WHITE WINS!")
    : "DRAW";

  let popup = document.createElement("div");
  popup.className = "endPopup";
  popup.innerHTML = msg;
  document.body.appendChild(popup);

  document.getElementById("analysis").classList.remove("hidden");
  document.getElementById("restart").classList.remove("hidden");
  playGameOverSound();
}

document.getElementById("restart").onclick = () => location.reload();


/* =======================
   Sound Functions (Retained from Main Code)
   ======================= */
var audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function beep(freq,dur,when=0){
  ensureAudio();
  var o=audioCtx.createOscillator();
  var g=audioCtx.createGain();
  o.type='sine';
  o.frequency.value=freq;
  o.connect(g);
  g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0.0001,audioCtx.currentTime+when);
  g.gain.exponentialRampToValueAtTime(0.2,audioCtx.currentTime+when+0.01);
  o.start(audioCtx.currentTime+when);
  g.gain.exponentialRampToValueAtTime(0.0001,audioCtx.currentTime+when+dur);
  o.stop(audioCtx.currentTime+when+dur+0.02);
}
function playMoveSound(){ beep(880,0.06); }
function playCaptureSound(){ beep(600,0.06); beep(400,0.04,0.06); }
function playCheckSound(){ beep(1200,0.12); }
function playGameOverSound(){ beep(200,0.6); }

function playDeathModeSound(){
  ensureAudio();
  var o = audioCtx.createOscillator();
  var g = audioCtx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(100, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 2);
  o.connect(g);
  g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0.5, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 2);
  o.start();
  o.stop(audioCtx.currentTime + 2);
}

/* =======================
   Firebase Loader (Retained & Adapted)
   ======================= */
$(document).ready(function(){
  setupFirebaseModuleLoader();
});

function setupFirebaseModuleLoader(){
  var moduleScript=document.createElement('script');
  moduleScript.type='module';
  moduleScript.text=`
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
    import { getDatabase, ref, onValue, set, update } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';
    const firebaseConfig = { apiKey: "YOUR_API_KEY", authDomain: "YOUR_AUTH_DOMAIN", databaseURL: "YOUR_DATABASE_URL", projectId: "YOUR_PROJECT_ID", storageBucket: "YOUR_STORAGE_BUCKET", messagingSenderId: "YOUR_MESSAGING_SENDER_ID", appId: "YOUR_APP_ID" };
    try { 
      const app = initializeApp(firebaseConfig); 
      const db = getDatabase(app); 
      // Expose db globally for the new code to work
      window.db = db; 
      window.firebase = { database: db };
    } catch(e) { console.log("Firebase not configured"); }
  `;
  document.body.appendChild(moduleScript);
}
