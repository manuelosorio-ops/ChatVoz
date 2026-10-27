"""
Cami - Asistente conversacional Voz a Voz (backend)
FastAPI + Azure OpenAI (gpt-4.1)

Ejecutar:  uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import logging
import os
import re
from functools import lru_cache
from typing import List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    AzureOpenAI,
    BadRequestError,
    RateLimitError,
)
from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("cami")

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview").strip()
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1").strip()

CAMI_TEMPERATURE = float(os.getenv("CAMI_TEMPERATURE", "0.4"))
CAMI_MAX_TOKENS = int(os.getenv("CAMI_MAX_TOKENS", "220"))
CAMI_MAX_HISTORY = int(os.getenv("CAMI_MAX_HISTORY", "12"))

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]

# ---------------------------------------------------------------------------
# System Prompt de Cami
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """
Eres Cami, la asistente virtual de atención ciudadana. Eres amable, cercana, concisa y empática.
Hablas en español neutro latinoamericano (con calidez colombiana) y tratas a las personas de "usted"
salvo que ellas te tuteen primero.

CANAL: VOZ. Todo lo que escribas será leído en voz alta por un sintetizador.
Reglas de formato obligatorias:
- Responde en máximo 2 o 3 frases cortas y naturales, como si hablaras por teléfono.
- No uses viñetas, listas numeradas, asteriscos, almohadillas, emojis, tablas ni markdown.
- No dictes URLs largas ni correos completos; di por ejemplo "en la sección PQRS de nuestro portal web".
- Escribe las horas de forma natural: "de ocho de la mañana a cuatro de la tarde".
- Evita siglas difíciles de pronunciar; si usas PQRS, puedes aclarar "peticiones, quejas, reclamos y sugerencias" la primera vez.
- Si la respuesta requiere varios pasos, da solo el primero o los dos primeros y ofrece continuar.
- Termina, cuando tenga sentido, con una pregunta breve para mantener la conversación.

BASE DE CONOCIMIENTO:
1. Horario de atención: lunes a viernes de 8:00 a. m. a 4:00 p. m., jornada continua. No hay atención
   presencial sábados, domingos ni festivos. Los canales virtuales funcionan las 24 horas.
2. PQRS (peticiones, quejas, reclamos, sugerencias y denuncias): se radican en línea en la sección PQRS
   del portal web, las 24 horas. Al radicar se entrega un número de radicado para hacer seguimiento.
   El plazo general de respuesta es de hasta 15 días hábiles para peticiones; las consultas pueden tardar
   hasta 30 días hábiles y las solicitudes de documentos o información hasta 10 días hábiles.
3. Citas presenciales: se agendan en el portal web, en la opción "Agendar cita", eligiendo el trámite,
   la sede, la fecha y la hora. Se recomienda llegar 10 minutos antes con el documento de identidad original
   y el número de confirmación. La cita se puede reprogramar o cancelar desde el mismo portal.
4. Ubicación de oficinas: existe una sede principal y puntos de atención en varias zonas de la ciudad.
   La dirección exacta y la sede más cercana se consultan en la sección "Sedes y puntos de atención" del portal.
   No inventes direcciones específicas.
5. Seguimiento de trámites: con el número de radicado en la opción "Consultar estado" del portal.
6. Orientación general: puedes explicar de forma general qué es un trámite, qué documentos suelen pedirse
   (documento de identidad, formularios, soportes) y orientar a la persona hacia el canal correcto.

LÍMITES:
- Si no conoces un dato concreto (costos, requisitos específicos, direcciones, números de teléfono),
  dilo con honestidad y orienta hacia el portal web o la línea de atención. Nunca inventes datos.
- No solicites datos sensibles como contraseñas o números completos de tarjetas.
- Si la persona está molesta o frustrada, valida su emoción en pocas palabras antes de orientar.
- Si la pregunta no tiene relación con trámites o atención ciudadana, responde con amabilidad que solo
  puedes ayudar con temas de atención al ciudadano.
""".strip()

SUGGESTIONS = [
    "¿Cuáles son los horarios de atención?",
    "¿Cómo agendo una cita presencial?",
    "¿Cómo radico una PQRS en línea?",
    "¿Dónde están ubicadas las oficinas?",
    "¿Cómo consulto el estado de mi trámite?",
]

FALLBACK_REPLY = "Lo siento, en este momento no pude procesar su solicitud. ¿Me la puede repetir, por favor?"

# ---------------------------------------------------------------------------
# Cliente Azure OpenAI (lazy, para que /api/health funcione aun sin clave)
# ---------------------------------------------------------------------------
def is_configured() -> bool:
    return bool(AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY and "<tu-clave>" not in AZURE_OPENAI_API_KEY)


@lru_cache(maxsize=1)
def get_client() -> AzureOpenAI:
    if not is_configured():
        raise RuntimeError("Azure OpenAI no está configurado. Revisa el archivo backend/.env")
    return AzureOpenAI(
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
        api_key=AZURE_OPENAI_API_KEY,
        api_version=AZURE_OPENAI_API_VERSION,
        timeout=30.0,
        max_retries=2,
    )


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: Optional[List[ChatTurn]] = None

    @field_validator("message")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("El mensaje no puede estar vacío.")
        return v


class ChatResponse(BaseModel):
    reply: str


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
_MD_PATTERNS = [
    (re.compile(r"\[([^\]]+)\]\((?:https?://)?[^)]+\)"), r"\1"),  # [texto](url) -> texto
    (re.compile(r"https?://\S+"), "nuestro portal web"),            # URLs sueltas
    (re.compile(r"[*_`#>|~]+"), ""),                                # símbolos markdown
    (re.compile(r"^\s*[-•]\s+", re.MULTILINE), ""),                 # viñetas
    (re.compile(r"^\s*\d+[.)]\s+", re.MULTILINE), ""),              # listas numeradas
    (re.compile(r"\s+"), " "),                                      # espacios/saltos
]


def clean_for_speech(text: str) -> str:
    """Red de seguridad: elimina restos de markdown/URLs que entorpecen el TTS."""
    for pattern, repl in _MD_PATTERNS:
        text = pattern.sub(repl, text)
    return text.strip()


def build_messages(req: ChatRequest) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in (req.history or [])[-CAMI_MAX_HISTORY:]:
        if turn.content.strip():
            messages.append({"role": turn.role, "content": turn.content.strip()})
    messages.append({"role": "user", "content": req.message})
    return messages


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Cami API", version="1.0.0", description="Asistente de voz para atención ciudadana")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "cami-backend",
        "azure_configured": is_configured(),
        "deployment": AZURE_OPENAI_DEPLOYMENT,
        "api_version": AZURE_OPENAI_API_VERSION,
    }


@app.get("/api/suggestions")
def suggestions():
    return {"suggestions": SUGGESTIONS}


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    # Endpoint síncrono: FastAPI lo ejecuta en un threadpool, sin bloquear el event loop.
    try:
        client = get_client()
    except RuntimeError as exc:
        logger.error(str(exc))
        raise HTTPException(status_code=503, detail=str(exc))

    try:
        completion = client.chat.completions.create(
            model=AZURE_OPENAI_DEPLOYMENT,  # en Azure, "model" = nombre del deployment
            messages=build_messages(req),
            temperature=CAMI_TEMPERATURE,
            max_tokens=CAMI_MAX_TOKENS,
        )
    except AuthenticationError:
        logger.exception("Credenciales inválidas de Azure OpenAI")
        raise HTTPException(status_code=502, detail="Credenciales de Azure OpenAI inválidas.")
    except RateLimitError:
        logger.warning("Rate limit alcanzado en Azure OpenAI")
        raise HTTPException(status_code=429, detail="Hay muchas solicitudes en este momento. Intente de nuevo en unos segundos.")
    except (APITimeoutError, APIConnectionError):
        logger.exception("No se pudo conectar con Azure OpenAI")
        raise HTTPException(status_code=504, detail="No fue posible conectar con el servicio de IA.")
    except BadRequestError as exc:
        # Incluye bloqueos del filtro de contenido de Azure (content_filter)
        logger.warning("Solicitud rechazada por Azure OpenAI: %s", exc)
        return ChatResponse(reply="Disculpe, no puedo ayudarle con esa solicitud. ¿Hay algún trámite en el que le pueda orientar?")
    except APIStatusError as exc:
        logger.exception("Error de Azure OpenAI (%s)", exc.status_code)
        raise HTTPException(status_code=502, detail="El servicio de IA respondió con un error.")
    except Exception:
        logger.exception("Error inesperado en /api/chat")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

    choice = completion.choices[0] if completion.choices else None
    raw = (choice.message.content or "") if choice and choice.message else ""
    reply = clean_for_speech(raw) or FALLBACK_REPLY
    if choice and choice.finish_reason == "content_filter":
        reply = "Disculpe, no puedo responder a eso. ¿Le ayudo con algún trámite?"
    return ChatResponse(reply=reply)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
