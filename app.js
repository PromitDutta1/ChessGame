var board = null;
var game = new Chess();
var theme = 'dark';

function updateStatus() {
    var status = '';
    if(game.in_checkmate()){
        status = 'Checkmate! Game over.';
    } else if(game.in_draw()){
        status = 'Draw! Game over.';
    } else {
        status = (game.turn() === 'w' ? 'White' : 'Black') + ' to move';
        if(game.in_check()){ status += ' (CHECK!)'; }
    }
    document.getElementById('status').innerText = status;
}

function onDragStart(source, piece, position, orientation){
    if(game.game_over()) return false;
    if((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
       (game.turn() === 'b' && piece.search(/^w/) !== -1)){
        return false;
    }
}

function onDrop(source, target){
    var move = game.move({from: source, to: target, promotion:'q'});
    if(move === null) return 'snapback';
    updateStatus();
}

function onSnapEnd(){
    board.position(game.fen());
}

function createBoard(){
    if(board) board.clear();
    var config = {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        pieceTheme: function(piece){ return 'pieces/' + piece + '.png'; }
    };
    board = Chessboard('board', config);
    updateStatus();
}

document.getElementById('themeSelect').addEventListener('change', function(e){
    theme = e.target.value;
    createBoard();
});

createBoard();
