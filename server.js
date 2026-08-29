const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8080 });

const rooms = {}; 
// rooms = {
//   ABCD: {
//     players: [ { ws, name, color } ],
//     turnIndex: 0
//   }
// }

const COLORS = ["red", "green", "yellow", "blue"];

function broadcast(roomCode, data) {
    rooms[roomCode].players.forEach(p => {
        p.ws.send(JSON.stringify(data));
    });
}

wss.on("connection", (ws) => {

    ws.on("message", (msg) => {
        const data = JSON.parse(msg);

        // 🔹 JOIN ROOM
        if (data.type === "JOIN_ROOM") {
            const { room, name } = data;

            if (!rooms[room]) {
                rooms[room] = { players: [], turnIndex: 0 };
            }

            const roomObj = rooms[room];

            if (roomObj.players.length >= 4) {
                ws.send(JSON.stringify({
                    type: "ROOM_FULL"
                }));
                return;
            }

            const color = COLORS[roomObj.players.length];

            roomObj.players.push({ ws, name, color });
            ws.room = room;
            ws.color = color;

            ws.send(JSON.stringify({
                type: "JOIN_SUCCESS",
                color
            }));

            console.log(`${name} joined room ${room} as ${color}`);

            // 🔹 If 2+ players → start game
            if (roomObj.players.length >= 2) {
                const current = roomObj.players[roomObj.turnIndex];
                broadcast(room, {
                    type: "GAME_READY",
                    turn: current.color
                });
            }
        }

        // 🎲 ROLL DICE
        if (data.type === "ROLL_DICE") {
            const room = ws.room;
            if (!room) return;

            const roomObj = rooms[room];
            const current = roomObj.players[roomObj.turnIndex];

            if (current.ws !== ws) return;

            const dice = Math.floor(Math.random() * 6) + 1;

            broadcast(room, {
                type: "DICE_RESULT",
                dice,
                player: current.color
            });

            // next turn (unless 6)
            if (dice !== 6) {
                roomObj.turnIndex =
                    (roomObj.turnIndex + 1) % roomObj.players.length;
            }

            const next = roomObj.players[roomObj.turnIndex];
            broadcast(room, {
                type: "NEXT_TURN",
                turn: next.color
            });
        }
    });

    ws.on("close", () => {
        const room = ws.room;
        if (!room || !rooms[room]) return;

        rooms[room].players =
            rooms[room].players.filter(p => p.ws !== ws);

        if (rooms[room].players.length === 0) {
            delete rooms[room];
        }
    });
});

console.log("✅ WebSocket server running on port 8080");
