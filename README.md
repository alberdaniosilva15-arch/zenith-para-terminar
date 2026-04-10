# Zenith Ride 🚗

App de ride-hailing para Luanda, Angola. Stack: React + Vite + Supabase + Mapbox + Capacitor (Android).

## Stack
- **Frontend:** React 18 + TypeScript + Vite 5 + Tailwind CSS
- **Mobile:** Capacitor 8 (Android)
- **Backend:** Supabase (PostgreSQL + RLS + Edge Functions + Realtime)
- **Mapas:** Mapbox GL JS + Mapbox Directions API
- **VoIP:** Agora RTC
- **AI:** Gemini 1.5 Flash (via Edge Function proxy)

## Setup

### 1. Instalar dependências
```bash
npm install
```

### 2. Variáveis de ambiente
```bash
cp .env.example .env
# Preencher .env com as tuas chaves
```

### 3. Supabase
```bash
# Executar no SQL Editor do Supabase Dashboard:
# zenith_schema_final.sql

# Deploy da Edge Function Gemini:
npx supabase secrets set GEMINI_API_KEY="TUA_CHAVE"
npx supabase functions deploy gemini-proxy --no-verify-jwt
```

### 4. Desenvolvimento web
```bash
npm run dev
```

### 5. Build Android
```bash
npm run build
npx cap sync
npx cap open android
```

## Variáveis de Ambiente
| Variável | Onde obter |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API |
| `VITE_MAPBOX_TOKEN` | mapbox.com → Access Tokens |
| `VITE_AGORA_APP_ID` | console.agora.io |
| `GEMINI_API_KEY` | aistudio.google.com (secret da Edge Function — nunca no .env) |

## Estrutura
```
src/
├── components/     # Componentes reutilizáveis
├── contexts/       # AuthContext, etc.
├── lib/            # supabase.ts, mapbox-directions.ts, gemini.ts
├── pages/          # Páginas por rota
├── store/          # Zustand stores
└── types/          # Interfaces TypeScript globais
```
