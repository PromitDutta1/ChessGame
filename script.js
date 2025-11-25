/* =========================================================================
   PART 1: CONFIG, AUTH, AND SOUND ENGINE
   ========================================================================= */

// 1. FIREBASE INITIALIZATION
const firebaseConfig = {
  apiKey: "AIzaSyB_Xz-MtXJD5nHfElP5MmhN2T6iNJlYMSk",
  authDomain: "procheeser-824bf.firebaseapp.com",
  projectId: "procheeser-824bf",
  storageBucket: "procheeser-824bf.firebasestorage.app",
  messagingSenderId: "1073557932074",
  appId: "1:1073557932074:web:6ba905d0b6caeee61d9b53",
  measurementId: "G-D94BYJCPDW",
  databaseURL: "https://procheeser-824bf-default-rtdb.firebaseio.com/"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();
const provider = new firebase.auth.GoogleAuthProvider();

// 2. GLOBAL VARIABLES
var board = null;
var game = new Chess();
var $status = $('#statusText');

var gameMode = 'ai'; // 'ai', 'local', 'online_friend', 'online_random'
var aiDepth = 3;
var playerColor = 'white';
var isAiThinking = false;

var timerInterval = null;
var whiteTime = 600, blackTime = 600;
var gameActive = false, timerStarted = false;
var redoStack = [];
var selectedSquare = null; // New variable for Tap-to-Move

// Analysis State
var isAnalysis = false;
var analysisHistory = [];
var analysisIndex = -1;

// Stockfish Engine
var engine = null;
var engineReady = false;

// Online State
var currentUser = null; 
var currentRoomId = null;
var onlineUnsub = null;

// Audio Context
var audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

// 3. AUTHENTICATION HANDLERS
$('#loginBtn').on('click', () => {
    auth.signInWithPopup(provider).catch(e => alert(e.message));
});

$('#logoutBtn').on('click', () => {
    auth.signOut();
    location.reload();
});

auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
        $('#authContainer').hide();
        $('#userInfo').css('display', 'flex');
        $('#userName').text(user.displayName.split(' ')[0]);
        $('#userAvatar').attr('src', user.photoURL);
        $('#bottomPlayerLabel').text(user.displayName);
    } else {
        $('#authContainer').show();
        $('#userInfo').hide();
        $('#bottomPlayerLabel').text("You (Guest)");
    }
});

// 4. SOUND ENGINE (Original Preserved)
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

// 5. INITIALIZATION & UI SETUP
$('#gameMode').on('change', function() {
    $('.mode-options').hide();
    let mode = $(this).val();
    if(mode === 'ai') { $('#aiOptions').show(); }
    else if(mode === 'local') { $('#localOptions').show(); }
    else if(mode === 'online_friend') { $('#friendOptions').show(); }
    else if(mode === 'online_random') { $('#randomOptions').show(); }
});

$('#startAiBtn').on('click', () => initGame('ai'));
$('#startLocalBtn').on('click', () => initGame('local'));
$('#joinCreateBtn').on('click', () => initOnlineFriend());
$('#findMatchBtn').on('click', () => initOnlineRandom());

function initGame(mode, roomId = null, assignedColor = null) {
  if(isAnalysis) exitAnalysis();

  stopTimer();
  timerStarted = false;
  if(onlineUnsub){ onlineUnsub(); onlineUnsub=null; }
  
  gameMode = mode || 'ai';
  currentRoomId = roomId;
  
  // Settings
  aiDepth = parseInt($('#difficulty').val()) || 3;
  checkDeathMode(aiDepth); // Original Visuals

  if(gameMode === 'ai') {
      playerColor = $('#aiColor').val();
  } else if(gameMode.includes('online')) {
      playerColor = assignedColor || 'white';
  } else {
      playerColor = 'white';
  }

  var startSeconds = parseInt($('#timeControl').val());
  whiteTime = startSeconds; blackTime = startSeconds;
  
  gameActive = true;
  updateTimerDisplay();
  
  // UI States
  $('#analyzeBtn').hide();
  $('#gameSettings').hide();
  $('#inGameControls').show();
  
  if(gameMode === 'local'){ 
      $('#undoRedoControls').hide(); 
      $('#drawBtn').hide(); 
  }
  else if(gameMode.includes('online')){ 
      $('#undoRedoControls').hide(); 
      $('#drawBtn').show(); 
  }
  else{ 
      $('#undoRedoControls').show(); 
      $('#drawBtn').hide(); 
  }

  game.reset();
  redoStack = [];
  isAiThinking = false;
  isAnalysis = false;

  var config = {
    draggable: true,
    position: 'start',
    orientation: playerColor,
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png', 
    onDragStart: onDragStart,
    onDrop: onDrop,
    onMouseoutSquare: onMouseoutSquare,
    onMouseoverSquare: onMouseoverSquare,
    onSnapEnd: onSnapEnd
  };

  board = Chessboard('myBoard', config);

  updateStatus();
  
  if(gameMode === 'ai') {
      ensureEngine();
      if(playerColor === 'black') setTimeout(makeAiMove, 250);
  }
  else if(gameMode.includes('online')) {
      subscribeToRoom(currentRoomId);
  }
}
/* =========================================================================
   PART 2: ONLINE MATCHMAKING, AI LOGIC, AND GAME LOOP
   ========================================================================= */
/* --- TAP TO MOVE FUNCTIONS --- */
function highlightSquare(square) {
    var $square = $('#myBoard .square-' + square);
    $square.addClass('highlight-selected');
}

function removeHighlights() {
    $('#myBoard .square-55d63').removeClass('highlight-selected');
    $('#myBoard .square-55d63').css('background', '');
}

function handleSquareClick(square) {
    // Safety checks
    if(!gameActive || isAiThinking || isAnalysis) return;
    if(whiteTime <= 0 || blackTime <= 0) return;

    // 1. First Click (Select Piece)
    if (!selectedSquare) {
        var piece = game.get(square);
        // Ensure it is your turn and your piece
        if (!piece || piece.color !== game.turn()) return;
        
        // Restrictions for AI/Online
        if (gameMode === 'ai' && piece.color !== playerColor.charAt(0)) return;
        if (gameMode.includes('online') && piece.color !== playerColor.charAt(0)) return;
        
        selectedSquare = square;
        highlightSquare(square);
        return;
    }

    // 2. Second Click (Move or Change Selection)
    var piece = game.get(square);
    
    // If clicking same square or another own piece -> Change selection
    if (square === selectedSquare || (piece && piece.color === game.turn())) {
        selectedSquare = square;
        removeHighlights();
        highlightSquare(square);
        return;
    }

    // Try to Move
    var move = game.move({
        from: selectedSquare,
        to: square,
        promotion: 'q' // Always promote to Queen on tap
    });

    // Invalid Move? Cancel selection
    if (move === null) {
        selectedSquare = null;
        removeHighlights();
        return;
    }

    // Valid Move! Reset selection and update board
    selectedSquare = null;
    removeHighlights();
    
    // --- Update Game State (Same as onDrop) ---
    board.position(game.fen());
    if (move.captured) playCaptureSound(); else playMoveSound();
    if (game.in_check()) playCheckSound();
    
    updateStatus();
    updateTimerDisplay();
    if (!timerStarted) startTimer();
    redoStack = [];

    // Trigger Online/AI
    if (gameMode.includes('online') && currentRoomId) pushMoveToRoom(currentRoomId, game.fen(), move.san);
    if (gameMode === 'ai' && !game.game_over()) { 
        isAiThinking = true; 
        $status.text("AI is thinking..."); 
        setTimeout(makeAiMove, 250); 
    }
}

// 6. ONLINE MATCHMAKING
async function initOnlineRandom() {
    if (!currentUser) { alert("Login required for Ranked Matches."); return; }
    $('#findMatchBtn').text("Searching...");

    const snapshot = await db.ref('rooms').orderByChild('status').equalTo('waiting_random').limitToFirst(1).get();

    if (snapshot.exists()) {
        const rid = Object.keys(snapshot.val())[0];
        if (snapshot.val()[rid].hostUid !== currentUser.uid) {
             await db.ref('rooms/' + rid).update({
                status: 'playing',
                blackPlayer: currentUser.uid,
                blackName: currentUser.displayName
            });
            initGame('online_random', rid, 'black');
            return;
        }
    }

    const newRid = db.ref('rooms').push().key;
    await db.ref('rooms/' + newRid).set({
        status: 'waiting_random',
        hostUid: currentUser.uid,
        whitePlayer: currentUser.uid,
        whiteName: currentUser.displayName,
        fen: 'start',
        created: firebase.database.ServerValue.TIMESTAMP
    });
    initGame('online_random', newRid, 'white');
    $status.text("Searching for opponent...");
}

async function initOnlineFriend() {
    let roomId = $('#roomIdInput').val().trim();
    let chosenColor = $('#friendColor').val();

    if (!roomId) {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        let hostColor = 'white';
        if(chosenColor === 'black') hostColor = 'black';
        else if(chosenColor === 'random') hostColor = Math.random() < 0.5 ? 'white' : 'black';
        
        await db.ref('rooms/' + roomId).set({
            fen: 'start',
            status: 'waiting',
            hostColor: hostColor,
            whitePlayer: (hostColor === 'white' ? (currentUser ? currentUser.uid : 'GuestHost') : null),
            blackPlayer: (hostColor === 'black' ? (currentUser ? currentUser.uid : 'GuestHost') : null),
            created: firebase.database.ServerValue.TIMESTAMP
        });
        $('#roomIdInput').val(roomId);
        alert(`Room Created: ${roomId}`);
        initGame('online_friend', roomId, hostColor);
    } else {
        const snap = await db.ref('rooms/' + roomId).get();
        if(!snap.exists()) { alert("Room not found!"); return; }
        
        const val = snap.val();
        let myColor = (val.whitePlayer) ? 'black' : 'white';
        await db.ref('rooms/' + roomId).update({ status: 'playing' });
        initGame('online_friend', roomId, myColor);
    }
}

function subscribeToRoom(roomId){
  if(onlineUnsub){ onlineUnsub(); onlineUnsub=null; }
  
  const roomRef = db.ref('rooms/' + roomId);
  onlineUnsub = roomRef.on('value', (snapshot) => {
    var val=snapshot.val(); if(!val) return;
    
    // Sync Board
    if(val.fen && val.fen!==game.fen() && val.fen !== 'start'){ 
        game.load(val.fen); 
        board.position(game.fen()); 
        updateStatus(); 
        playMoveSound();
        if(!timerStarted && val.status === 'playing') startTimer();
    }
    
    // Sync Start
    if(val.status === 'playing' && $status.text().includes("Searching")){
        $status.text("Opponent Found! Game Started.");
        playCheckSound();
    }
    
    // Sync Result
    if(val.gameResult && gameActive) { 
        finishGame("Online: " + val.gameResult); 
    }
    
    // Sync Draw
    if(val.drawOffer && val.drawOffer !== playerColor) {
        if(confirm("Opponent offers a draw. Accept?")) {
            pushGameEndToRoom(roomId, "Draw agreed");
            roomRef.update({drawOffer: null});
        } else {
            roomRef.update({drawOffer: null}); 
            alert("Draw rejected");
        }
    }
  });
}

function pushMoveToRoom(roomId, fen, san){
    db.ref('rooms/'+roomId).update({ fen: fen, lastSan: san, timestamp: firebase.database.ServerValue.TIMESTAMP });
}
function pushGameEndToRoom(roomId, text){ db.ref('rooms/'+roomId).update({ gameResult: text }); }
function pushDrawOffer(roomId, color){ db.ref('rooms/'+roomId).update({ drawOffer: color }); }


// 7. STOCKFISH AI (Original Logic Preserved)
async function ensureEngine(){
  if(engine && engineReady) return;
  engineReady = false;
  try {
      const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.0/stockfish.js');
      const scriptContent = await response.text();
      const blob = new Blob([scriptContent], { type: 'application/javascript' });
      engine = new Worker(URL.createObjectURL(blob));
  } catch(e) { engine = null; return; }

  engine.onmessage = function(event){
    var line = typeof event==='string'? event: (event.data||event);
    if(line === 'uciok'){ engineReady = true; }

    if(!isAnalysis && line.startsWith("bestmove")){
      let parts = line.split(' ');
      let moveStr = parts[1];
      if(moveStr && moveStr !== '(none)'){
          game.move({ from: moveStr.substring(0,2), to: moveStr.substring(2,4), promotion:'q' });
          board.position(game.fen());
          isAiThinking = false;
          updateStatus();
          updateTimerDisplay();
          playMoveSound();
          
          const aiStatusElem = document.getElementById("aiStatus");
          if(aiStatusElem) aiStatusElem.textContent = "";
      }
    }

    if(isAnalysis && typeof line==='string') {
        if(line.indexOf('score cp') !== -1 || line.indexOf('score mate') !== -1) {
            var scoreMatch = line.match(/score cp (-?\d+)/);
            var mateMatch = line.match(/score mate (-?\d+)/);
            if(mateMatch) { $('#evalScore').text("Mate in " + mateMatch[1]); } 
            else if(scoreMatch) { var score = parseInt(scoreMatch[1]) / 100; $('#evalScore').text((score > 0 ? "+" : "") + score.toFixed(2)); }
        }
        if(line.indexOf(' pv ') !== -1) {
             var pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8])/);
             if(pvMatch && pvMatch[1]) $('#bestMove').text(pvMatch[1]);
        }
    }
  };
  engine.postMessage("uci");
}

function makeAiMove(){
    if(game.game_over() || !gameActive || !engine) return;

    isAiThinking = true;
    const aiStatusElem = document.getElementById("aiStatus");
    if(aiStatusElem) {
        aiStatusElem.textContent = "AI is thinking";
        let dots = 0;
        let int = setInterval(() => { 
            if(!isAiThinking) clearInterval(int);
            dots=(dots+1)%4; aiStatusElem.textContent="AI is thinking"+'.'.repeat(dots); 
        }, 500);
    }

    if(!timerStarted) startTimer();

    // Specific AI Levels (Preserved)
    const aiSettings = {
        1: {depth: 6, movetime: 100},
        2: {depth: 8, movetime: 200},
        3: {depth: 10, movetime: 300},
        4: {depth: 12, movetime: 400},
        5: {depth: 14, movetime: 500},
        6: {depth: 18, movetime: 1200}, 
        7: {depth: 28, movetime: 2000} 
    };
    const settings = aiSettings[aiDepth] || {depth:10, movetime:300};

    engine.postMessage('ucinewgame');
    engine.postMessage('position fen ' + game.fen());
    if(aiDepth >= 6) engine.postMessage('go movetime ' + settings.movetime);
    else engine.postMessage('go depth ' + settings.depth);
}


// 8. MOVE HANDLERS
function onDragStart(source, piece) {
  // 1. Basic Safety Checks
  if (isAnalysis) return false;
  if (game.game_over() || !gameActive || isAiThinking) return false;
  if (whiteTime <= 0 || blackTime <= 0) return false;

  // 2. HYBRID LOGIC: Cancel Tap Selection if Dragging starts
  // This makes "Tap" and "Drag" work perfectly together.
  if (selectedSquare) { 
      selectedSquare = null; 
      removeHighlights(); 
  }

  // 3. AI Mode Restrictions
  if (gameMode === 'ai') {
    if ((playerColor === 'white' && piece.search(/^b/) !== -1) || 
        (playerColor === 'black' && piece.search(/^w/) !== -1)) {
        return false;
    }
  }

  // 4. Online Mode Restrictions
  if (gameMode.includes('online')) {
      if ((playerColor === 'white' && game.turn() === 'b') || 
          (playerColor === 'black' && game.turn() === 'w')) {
          return false;
      }
      if ($status.text().includes("Searching")) return false;
  }
}

function onDrop(source,target){
  var move=game.move({from:source,to:target,promotion:'q'});
  if(move===null) return 'snapback';
  
  if(move.captured) playCaptureSound(); else playMoveSound();
  if(game.in_check()) playCheckSound();
  
  redoStack=[];
  if(!timerStarted) startTimer();
  updateStatus();
  updateTimerDisplay();
  board.position(game.fen());

  if(gameMode.includes('online') && currentRoomId){ 
      pushMoveToRoom(currentRoomId, game.fen(), move.san); 
  }

  if(gameMode==='ai' && !game.game_over()){ 
      isAiThinking=true; 
      $status.text("AI is thinking..."); 
      setTimeout(makeAiMove,120); 
  }
}
function onSnapEnd(){ board.position(game.fen()); }
/* =========================================================================
   PART 3: UI ACTIONS, ANALYSIS, AND GAME OVER OVERLAY
   ========================================================================= */

// 9. TIMER LOGIC
function startTimer(){
  if(timerInterval) clearInterval(timerInterval);
  timerStarted=true;
  timerInterval=setInterval(function(){
    if(!gameActive) return;
    if(game.turn()==='w'){ whiteTime--; if(whiteTime<=0) endGameByTime('White'); }
    else { blackTime--; if(blackTime<=0) endGameByTime('Black'); }
    updateTimerDisplay();
  },1000);
}
function stopTimer(){ if(timerInterval) clearInterval(timerInterval); timerInterval=null; }

function endGameByTime(colorWhoLost){
  if(gameMode.includes('online')) {
      let winner = (colorWhoLost === 'White') ? 'Black' : 'White';
      pushGameEndToRoom(currentRoomId, `${winner} won on time`);
  } else {
      finishGame('Game Over! '+colorWhoLost+' ran out of time.');
  }
}

function updateTimerDisplay(){
  function formatTime(t){ if(t>90000) return "∞"; var min=Math.floor(t/60); var sec=t%60; return (min<10?"0"+min:min)+":"+(sec<10?"0"+sec:sec); }
  $('#time-w').text(formatTime(whiteTime));
  $('#time-b').text(formatTime(blackTime));
  if(gameActive && timerStarted){
    if(game.turn()==='w'){$('#timer-white-container').addClass('active'); $('#timer-black-container').removeClass('active');}
    else{$('#timer-black-container').addClass('active'); $('#timer-white-container').removeClass('active');}
  }else{$('.timer-display').removeClass('active');}
}


// 10. GAME OVER & OVERLAY
function updateStatus() {
  let status = '';
  let moveColor = (game.turn() === 'b') ? 'Black' : 'White';

  if (game.in_checkmate()) {
    let winner = (moveColor === 'White') ? 'Black' : 'White';
    if(gameMode.includes('online')){
        if(playerColor.charAt(0) === winner.charAt(0).toLowerCase())
           pushGameEndToRoom(currentRoomId, `${winner} Wins by Checkmate!`);
    } else {
        finishGame(`${winner} Wins by Checkmate!`);
        triggerBoardWinAnimation();
    }
    return;
  }

  if (game.in_draw()) {
    if(gameMode.includes('online')){
        pushGameEndToRoom(currentRoomId, "Draw (Stalemate)");
    } else {
        finishGame("Game Draw (Stalemate)");
        triggerBoardDrawAnimation();
    }
    return;
  }

  status = (!timerStarted) ? "Waiting..." : `${moveColor} to move${game.in_check() ? " (CHECK!)" : ""}`;
  $status.text(status);
}

function finishGame(reasonText) {
    gameActive = false;
    stopTimer();
    $status.text(reasonText);
    playGameOverSound();
    showEndGame(reasonText);
    $('#analyzeBtn').show();
}

/* =======================
   UPDATED: showEndGame Function
   (Replaces the old one to add "Main Menu" button)
   ======================= */
function showEndGame(result) {
    let overlay = document.getElementById("end-game-overlay");
    
    // 1. Create overlay if it doesn't exist
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'end-game-overlay';
        overlay.className = 'hidden'; 
        
        // NEW STRUCTURE: Message + Two Buttons
        overlay.innerHTML = `
            <div id="end-game-text" class="message"></div>
            <span style="font-size: 2rem; margin-bottom: 20px;">🎉 Game Over</span>
            <div style="display:flex; gap:15px; width:100%; justify-content:center;">
                <button id="overlay-analyze-btn" style="padding:15px 25px; font-size:18px; border-radius:10px; border:none; background:#4a90e2; color:white; cursor:pointer; font-weight:bold;">🔍 Analyze</button>
                <button id="overlay-menu-btn" style="padding:15px 25px; font-size:18px; border-radius:10px; border:none; background:#2ecc71; color:white; cursor:pointer; font-weight:bold;">🏠 Main Menu</button>
            </div>
        `;
        document.body.appendChild(overlay);
        
        // 2. Add Button Listeners (Only once)
        document.getElementById('overlay-analyze-btn').addEventListener('click', () => {
             startAnalysis();
        });

        document.getElementById('overlay-menu-btn').addEventListener('click', () => {
             overlay.classList.add("hidden");
             overlay.style.pointerEvents = "none";
             location.reload(); // 🔄 THIS RELOADS THE PAGE TO GO TO MENU
        });
    }

    const textElement = document.getElementById("end-game-text");
    if(textElement) textElement.textContent = result;

    // 3. Set colors (Win/Lose/Draw)
    overlay.classList.remove('win','lose','draw');
    if (result.toLowerCase().includes('draw')) overlay.classList.add('draw');
    else if (result.toLowerCase().includes(playerColor)) overlay.classList.add('lose');
    else overlay.classList.add('win');

    // 4. Show Overlay
    overlay.style.display = "flex";
    overlay.style.pointerEvents = "auto"; 
    overlay.classList.remove("hidden");
    overlay.classList.add("show");
    
    // Remove old button if it exists from previous versions
    const oldBtn = document.getElementById("close-end-screen");
    if(oldBtn) oldBtn.remove();
}



// 11. ANALYSIS MODE
$('#analyzeBtn').on('click', function() { startAnalysis(); });

function startAnalysis() {
    $('#end-game-overlay').addClass("hidden");
    isAnalysis = true; gameActive = false; stopTimer();
    analysisHistory = game.history({ verbose: true });
    analysisIndex = analysisHistory.length - 1;
    $('#gameSettings').hide();
    $('#inGameControls').hide();
    $('#analysisControls').show();
    $status.text("Analysis Mode");
    ensureEngine();
    updateAnalysisBoard();
}

function exitAnalysis() {
    isAnalysis = false;
    $('#gameSettings').show();
    $('#analysisControls').hide();
}

$('#exitAnalysisBtn').on('click', exitAnalysis);
$('#anStart').on('click', function(){ analysisIndex = -1; updateAnalysisBoard(); });
$('#anPrev').on('click', function(){ if(analysisIndex >= -1) analysisIndex--; updateAnalysisBoard(); });
$('#anNext').on('click', function(){ if(analysisIndex < analysisHistory.length - 1) analysisIndex++; updateAnalysisBoard(); });
$('#anEnd').on('click', function(){ analysisIndex = analysisHistory.length - 1; updateAnalysisBoard(); });

function updateAnalysisBoard() {
    var tempGame = new Chess();
    for(var i=0; i<=analysisIndex; i++) if(analysisHistory[i]) tempGame.move(analysisHistory[i]);
    board.position(tempGame.fen());
    $status.text("Move: " + (analysisIndex + 1) + " / " + analysisHistory.length);
    removeGreySquares();
    if(engine) {
        engine.postMessage('stop');
        engine.postMessage('position fen ' + tempGame.fen());
        engine.postMessage('go depth 15');
    }
}


// 12. UTILITIES, HELPERS, AND DEATH MODE
document.getElementById("difficulty").addEventListener("change", function(){
  aiDepth = Number(this.value);
  if(gameMode === 'ai') checkDeathMode(aiDepth);
});

function checkDeathMode(level) {
  let warning = document.getElementById("death-warning");
  if(level === 7){
    if(warning) warning.style.display = "block";
    playDeathModeSound();
    document.body.style.background = "black";
    document.body.style.color = "red";
  } else {
    if(warning) warning.style.display = "none";
    document.body.style.background = "#212121"; 
    document.body.style.color = "#eee";
  }
}

function removeGreySquares(){ $('#myBoard .square-55d63').css('background',''); }
function greySquare(square){ var $sq=$('#myBoard .square-'+square); var bg='#a9a9a9'; if($sq.hasClass('black-3c85d')) bg='#696969'; $sq.css('background',bg);}
function onMouseoverSquare(square,piece){ 
  if(isAnalysis) return;
  if(game.game_over() || !gameActive || isAiThinking) return;
  if(gameMode==='ai'){ var turn = game.turn()==='w'?'white':'black'; if(turn!==playerColor) return;}
  var moves = game.moves({square:square,verbose:true});
  if(moves.length===0) return;
  greySquare(square);
  for(var i=0;i<moves.length;i++) greySquare(moves[i].to);
}
function onMouseoutSquare(square,piece){ removeGreySquares(); }

function triggerBoardWinAnimation() {
  let boardElem = document.getElementById("myBoard");
  boardElem.classList.add("winner-animation");
  setTimeout(() => { boardElem.classList.remove("winner-animation"); }, 4000);
}
function triggerBoardDrawAnimation() {
  let boardElem = document.getElementById("myBoard");
  boardElem.classList.add("draw-animation");
  setTimeout(() => { boardElem.classList.remove("draw-animation"); }, 3000);
}


// 13. GAME ACTIONS (Undo, Redo, Resign, Draw)
$('#undoBtn').on('click',function(){
  if(gameMode!=='ai' || !gameActive || isAiThinking) return;
  var m1=game.undo(); if(m1) redoStack.push(m1);
  var m2=game.undo(); if(m2) redoStack.push(m2);
  board.position(game.fen());
  updateStatus();
});

$('#redoBtn').on('click',function(){
  if(gameMode!=='ai' || !gameActive || isAiThinking || !redoStack.length) return;
  game.move(redoStack.pop());
  game.move(redoStack.pop());
  board.position(game.fen());
  updateStatus();
});

$('#resetBtn').on('click', function(){
    if(!gameActive) { initGame(); return; }
    if(confirm("Exit / Reset game?")){ location.reload(); }
});

$('#resignBtn').on('click', function() {
    if(!gameActive) return;
    if(!confirm("Resign?")) return;
    
    if(gameMode.includes('online') && currentRoomId) {
        let winner = (playerColor === 'white') ? 'Black' : 'White';
        pushGameEndToRoom(currentRoomId, winner + " won by resignation");
    } else {
        finishGame("You Resigned.");
    }
});

$('#drawBtn').on('click', function() {
    if(!gameActive) return;
    if(gameMode.includes('online') && currentRoomId) {
        pushDrawOffer(currentRoomId, playerColor);
        alert("Draw offer sent.");
    }
});

// Final Bind
$(document).ready(function(){
  
  var config = {
    position: 'start',
    // This loads your local images
    pieceTheme: 'assets/pieces/{piece}.png'
  };

  board = Chessboard('myBoard', config);
  $('#inGameControls').hide();

  // --- BIND TAP EVENT ---
  // This enables the clicking on squares
  $('#myBoard').on('click', '.square-55d63', function() {
      var square = $(this).attr('data-square');
      handleSquareClick(square);
  });
});


