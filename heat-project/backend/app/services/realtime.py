import asyncio

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self.connections: dict[int, set[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        sockets = self.connections.get(user_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self.connections.pop(user_id, None)

    async def send_user(self, user_id: int, payload: dict) -> None:
        dead: list[WebSocket] = []
        for websocket in list(self.connections.get(user_id, set())):
            try:
                await websocket.send_json(payload)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(user_id, websocket)


hub = Hub()
_loop: asyncio.AbstractEventLoop | None = None


def set_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def push(user_id: int, payload: dict) -> None:
    loop = _loop
    if loop is None or not loop.is_running():
        return
    try:
        asyncio.run_coroutine_threadsafe(hub.send_user(user_id, payload), loop)
    except Exception:
        return
