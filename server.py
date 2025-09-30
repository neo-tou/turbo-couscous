import os
from apify_client import ApifyClient
from fastapi import FastAPI
import chess.pgn
import io
import httpx

# --- Safe token handling ---
APIFY_TOKEN = os.getenv("APIFY_TOKEN")  # <-- token comes from Apify environment variables
if not APIFY_TOKEN:
    raise RuntimeError("APIFY_TOKEN environment variable is not set!")

client = ApifyClient(token=APIFY_TOKEN)

app = FastAPI()

LICHESS_API_URL = "https://explorer.lichess.ovh/lichess?variant=standard&fen={fen}"

def check_book_move(fen, move_san, move_uci):
    try:
        resp = httpx.get(LICHESS_API_URL.format(fen=fen), timeout=3)
        resp.raise_for_status()
        data = resp.json()
        for m in data.get("moves", []):
            if m["uci"] == move_uci or m["san"] == move_san:
                return m.get("opening", {}).get("name", "Unknown opening")
    except Exception as e:
        print("Explorer API error:", e)
    return None

@app.post("/review_openings")
def review_openings(input_data: dict):
    pgn_text = input_data.get("pgn")
    if not pgn_text:
        return {"error": "No PGN provided"}

    pgn = io.StringIO(pgn_text)
    game = chess.pgn.read_game(pgn)
    if not game:
        return {"error": "Invalid PGN"}

    board = game.board()
    book_moves = []
    total_checked = 0
    max_moves = 10

    for move in game.mainline_moves():
        if total_checked >= max_moves:
            break
        san = board.san(move)
        uci = move.uci()
        fen_before = board.fen()
        opening_name = check_book_move(fen_before, san, uci)
        if opening_name:
            book_moves.append({"move": san, "opening": opening_name})
        board.push(move)
        total_checked += 1

    return {
        "total_checked": total_checked,
        "book_moves_count": len(book_moves),
        "book_moves": book_moves
    }
