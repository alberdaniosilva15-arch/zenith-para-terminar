"""
Kaze Voice Server — Edge TTS (Microsoft Neural Voices)
Servidor HTTP local que converte texto em áudio usando vozes neurais gratuitas.
Porta: 3848 | Apenas localhost | CORS habilitado para o CRM.

Uso: python kaze_voice_server.py
"""
import asyncio
import io
import json
import sys
from aiohttp import web
import edge_tts

VOICE = "pt-BR-AntonioNeural"  # Voz masculina brasileira neural
PORT = 3848
BIND = "127.0.0.1"

async def handle_tts(request):
    """POST /tts — Converte texto em áudio MP3"""
    try:
        data = await request.json()
        text = data.get("text", "").strip()
        voice = data.get("voice", VOICE)
        
        if not text:
            return web.json_response({"error": "Texto vazio"}, status=400)
        
        # Limitar a 1000 caracteres para evitar abuso
        text = text[:1000]
        
        # Gerar áudio
        communicate = edge_tts.Communicate(text=text, voice=voice)
        audio_buffer = io.BytesIO()
        
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_buffer.write(chunk["data"])
        
        audio_buffer.seek(0)
        audio_bytes = audio_buffer.read()
        
        if not audio_bytes:
            return web.json_response({"error": "Áudio vazio"}, status=500)
        
        return web.Response(
            body=audio_bytes,
            content_type="audio/mpeg",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Cache-Control": "no-cache",
            }
        )
    except Exception as e:
        print(f"[KAZE Voice] Erro: {e}", file=sys.stderr)
        return web.json_response({"error": str(e)}, status=500)

async def handle_voices(request):
    """GET /voices — Lista vozes disponíveis"""
    voices = await edge_tts.list_voices()
    pt_voices = [v for v in voices if v["Locale"].startswith("pt")]
    return web.json_response(pt_voices, headers={
        "Access-Control-Allow-Origin": "*",
    })

async def handle_health(request):
    """GET /health — Health check"""
    return web.json_response({"status": "ok", "voice": VOICE}, headers={
        "Access-Control-Allow-Origin": "*",
    })

async def handle_options(request):
    """OPTIONS — CORS preflight"""
    return web.Response(headers={
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    })

app = web.Application()
app.router.add_post("/tts", handle_tts)
app.router.add_get("/voices", handle_voices)
app.router.add_get("/health", handle_health)
app.router.add_options("/tts", handle_options)

if __name__ == "__main__":
    print(f"[KAZE Voice] Servidor TTS a iniciar em {BIND}:{PORT}")
    print(f"[KAZE Voice] Voz: {VOICE}")
    print(f"[KAZE Voice] Endpoint: POST http://{BIND}:{PORT}/tts")
    web.run_app(app, host=BIND, port=PORT, print=None)
    print(f"[KAZE Voice] Servidor activo!")
