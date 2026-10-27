# Cami · Asistente conversacional Voz a Voz

Prototipo de asistente de atención ciudadana: el usuario habla, Cami responde con voz.

```
Micrófono ──► SpeechRecognition (es-CO) ──► POST /api/chat ──► FastAPI ──► Azure OpenAI (gpt-4.1)
Altavoz   ◄── speechSynthesis (voz femenina es) ◄── { reply } ◄──────────────┘
```

## Estructura

```
ChatVoz/
├── backend/
│   ├── main.py              # FastAPI + AzureOpenAI + System Prompt de Cami
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js       # Tailwind v4 + proxy /api -> :8000
    ├── .env.example
    └── src/
        ├── main.jsx
        ├── index.css        # Tailwind + animaciones del orbe
        ├── api/cami.js      # Cliente HTTP (health, suggestions, chat)
        ├── hooks/
        │   ├── useSpeechRecognition.js   # STT
        │   └── useSpeechSynthesis.js     # TTS + selección de voz femenina
        └── components/
            ├── CamiChat.jsx  # Pantalla principal
            └── CamiOrb.jsx   # Orbe animado por estado
```

## Levantar en local

Requisitos: Python 3.10+, Node 18+ y **Chrome o Edge** (la Web Speech API de reconocimiento no está en Firefox).

### 1. Backend (terminal 1)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # y pon tu AZURE_OPENAI_API_KEY
uvicorn main:app --reload --port 8000
```

Verifica: http://localhost:8000/api/health (debe mostrar `"azure_configured": true`) y la documentación en http://localhost:8000/docs

### 2. Frontend (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Abre http://localhost:5173. El micrófono solo funciona en `localhost` o HTTPS.

## Endpoints

| Método | Ruta               | Descripción |
|--------|--------------------|-------------|
| GET    | `/api/health`      | Estado del servicio y si Azure está configurado |
| GET    | `/api/suggestions` | Preguntas frecuentes sugeridas |
| POST   | `/api/chat`        | `{ "message": str, "history": [{role, content}] }` → `{ "reply": str }` |

Errores: `503` sin configuración, `429` rate limit, `502/504` fallos de Azure. Si el filtro de contenido de Azure bloquea algo, Cami responde con una frase amable en vez de fallar.

## Uso

- **Micrófono (toggle):** toca para hablar; se envía solo al terminar la frase. Tocar mientras Cami habla la interrumpe.
- **Barra espaciadora:** atajo para el micrófono.
- **Silenciar / Detener voz:** en el header y junto al micrófono.
- **Modo manos libres:** al terminar de hablar, Cami vuelve a escuchar automáticamente.
- **Píldoras:** envían la pregunta sugerida directamente.
- **Campo de texto:** alternativa si el navegador no soporta voz.

## Notas

- La calidad de la voz depende del sistema: en Edge las voces "Microsoft Salome/Dalia Online (Natural)" suenan muy bien; en macOS, "Paulina" o "Mónica".
- `clean_for_speech()` en el backend elimina markdown y URLs como red de seguridad para el TTS.
- La clave de Azure vive solo en `backend/.env` (ignorado por git); nunca se expone al navegador.
