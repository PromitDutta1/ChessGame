var board = null;
var game = new Chess();
var $status = $('#statusText');
var gameMode = 'ai';
var aiDepth = 1;
var playerColor = 'white';
var isAiThinking = false;
var whiteTime = 600;
var blackTime = 600;
var timerInterval = null;
var gameActive = false;
var timerStarted = false;
var redoStack = [];

function initGame(){
    game.reset();
    redoStack = [];
    isAiThinking = false;
    gameMode = $('#gameMode').val();
    aiDepth = parseInt($('#difficulty').val());
    playerColor = $('#playerColor').val();
    var startSeconds = parseInt($('#timeControl').val());
    whiteTime = blackTime = startSeconds;
    gameActive = true;
    timerStarted = false;
    updateTimerDisplay();
    if(gameMode === 'local'){
        $('#aiSettings').hide(); $('#undoRedoControls').hide();
    } else { $('#aiSettings').show(); $('#undoRedoControls').show(); }
    var config = {
        draggable:true,
        position:'start',
        onDragStart:onDragStart,
        onDrop:onDrop,
        onSnapEnd:onSnapEnd,
        pieceTheme:function(piece){return 'pieces/' + piece + '.png';}
    };
    board = Chessboard('myBoard', config);
    board.orientation(playerColor);
    updateStatus();
    if(gameMode==='ai' && playerColor==='black'){setTimeout(makeAiMove,500);}
}

function startTimer(){ timerStarted=true; timerInterval=setInterval(()=>{
    if(!gameActive) return;
    if(game.turn()==='w'){ whiteTime--; if(whiteTime<=0) endGameByTime('White'); }
    else{ blackTime--; if(blackTime<=0) endGameByTime('Black'); }
    updateTimerDisplay();
},1000); }

function stopTimer(){ if(timerInterval) clearInterval(timerInterval); }

function updateTimerDisplay(){
    function f(t){ if(t>90000) return '∞'; var m=Math.floor(t/60),s=t%60; return (m<10?'0':'')+m+':'+(s<10?'0':'')+s; }
    $('#time-w').text(f(whiteTime)); $('#time-b').text(f(blackTime));
    if(timerStarted && gameActive){
        if(game.turn()==='w') { $('#timer-white-container').addClass('active'); $('#timer-black-container').removeClass('active'); }
        else { $('#timer-black-container').addClass('active'); $('#timer-white-container').removeClass('active'); }
    } else $('.timer-display').removeClass('active');
}

function endGameByTime(c){ gameActive=false; stopTimer(); $status.text(c+' ran out of time! Game Over.'); alert(c+' ran out of time!'); }

function onDragStart(source,piece,position,orientation){
    if(game.game_over() || !gameActive || isAiThinking) return false;
    if(gameMode==='ai'){
        if((playerColor==='white' && piece.search(/^b/)!==-1)||(playerColor==='black' && piece.search(/^w/)!==-1)) return false;
    }
}

function onDrop(source,target){
    var move = game.move({from:source,to:target,promotion:'q'});
    if(move===null) return 'snapback';
    redoStack=[]; if(!timerStarted) startTimer();
    updateStatus(); updateTimerDisplay();
    if(gameMode==='ai' && !game.game_over()){ isAiThinking=true; $status.text("AI is thinking..."); setTimeout(makeAiMove,250);}
}

function onSnapEnd(){ board.position(game.fen()); }

function makeAiMove(){
    if(game.game_over() || !gameActive) return;
    var moves = game.moves(); if(moves.length===0) return;
    var best = moves[Math.floor(Math.random()*moves.length)];
    game.move(best);
    if(!timerStarted) startTimer();
    board.position(game.fen());
    isAiThinking=false; updateStatus(); updateTimerDisplay();
}

function updateStatus(){
    var s=''; var c=(game.turn()==='w')?'White':'Black';
    if(game.in_checkmate()){ s='Game Over: '+c+' is in checkmate.'; gameActive=false; stopTimer(); alert(s);}
    else if(game.in_draw()){ s='Game Over: Drawn position'; gameActive=false; stopTimer();}
    else{ s=timerStarted?c+' to move'+(game.in_check()?' (CHECK!)':''):'Waiting for First Move...'; }
    $status.text(s);
}

$('#startBtn').on('click',initGame);
$('#resetBtn').on('click',initGame);
$('#gameMode').on('change',initGame);
$(document).ready(initGame);
$('#undoBtn').on('click',function(){
    if(gameMode==='local' || !gameActive || isAiThinking) return;
    var move1=game.undo(); if(!move1) return; redoStack.push(move1);
    if(move1.color!==playerColor.charAt(0)){ var move2=game.undo(); if(move2) redoStack.push(move2); }
    board.position(game.fen()); updateStatus();
});
$('#redoBtn').on('click',function(){
    if(gameMode==='local' || !gameActive || isAiThinking) return;
    if(redoStack.length===0) return;
    var move=redoStack.pop(); game.move(move);
    if(redoStack.length>0){ var nextMove=redoStack[redoStack.length-1]; if(nextMove.color!==playerColor.charAt(0)) game.move(redoStack.pop()); }
    board.position(game.fen()); updateStatus();
});
