# 🎯 GUIA FINAL DE CONFIGURAÇÃO EXTERNA - ZENITH RIDE V3

Para garantir que a aplicação arranca com todas as ferramentas a funcionar a 100%, deves seguir estes passos **na mesma ordem**. Estas são as ações "externas" (fora do código) que dependem de chaves secretas ou credenciais que apenas tu deves manipular.

---

## Passo 1: Limpeza e Atualização da Base de Dados (Supabase)

O código novo espera que a tua base de dados esteja atualizada e livre de lixo. 

1. Entra no painel de controlo do teu **Supabase** no navegador e abre a aba **SQL Editor**.
2. Abre o ficheiro `cleanup_tabelas_antigas.sql` no teu editor de código (VS Code). Copia todo o código e executa lá no Supabase. Isso vai apagar apenas o lixo antigo da "Kubata".
3. A seguir, abre o ficheiro `zenith_schema_final.sql`, copia todo o conteúdo atualizado e corre novamente no Supabase. Isso irá ativar os Contratos Escolares, Alertas de Desvio, e proteger todo o sistema novo.

---

## Passo 2: O Ficheiro de Segredos `.env`

O ficheiro `.env` não é guardado no GitHub (por motivos de segurança), ou seja, tens que o criar manualmente na tua pasta local:

1. Na pasta `zenith-ride-build`, cria um ficheiro chamado `.env`.
2. Cola o seguinte formato lá dentro e preenche com as tuas chaves autênticas de cada serviço:

```env
VITE_SUPABASE_URL=https://(TEU-LINK).supabase.co
VITE_SUPABASE_ANON_KEY=(A-TUA-CHAVE-PUBLICA-SUPABASE)
VITE_MAPBOX_TOKEN=(GERA-ESTA-CHAVE-NO-SITE-DA-MAPBOX)
VITE_AGORA_APP_ID=(A-TUA-CHAVE-DO-VOIP-AGORA)
VITE_GOOGLE_MAPS_KEY=(SE-AINDA-PENSAS-USAR-A-GOOGLE-COLOCA-AQUI)
```

> ⚠️ **Importante:** Não coloques a chave do Gemini AI aqui! Isso seria perigoso.

---

## Passo 3: Ativar o Agente Inteligente KAZE (Gemini AI)

Para que a inteligência artificial comunique com os utilizadores e responda no chat em bom angolano:

1. Abre um novo terminal / linha de comandos **na pasta do teu projeto**.
2. Faz login no serviço Supabase pela linha de comandos:
   ```bash
   npx supabase login
   ```
   *(Vai pedir permissão no browser para acederes à tua conta Supabase)*
3. Guarda a tua chave secreta de IA da Google nos servidores da cloud:
   ```bash
   npx supabase secrets set GEMINI_API_KEY="COLA-A-TUA-CHAVE-MAGICA-AQUI"
   ```
4. Finalmente, envia o robô Kaze que eu criei para as nuvens com o seguinte comando de "Deploy":
   ```bash
   npx supabase functions deploy gemini-proxy --no-verify-jwt
   ```
   *(Para confirmar que deu certo podes ir ao Dashboard do Supabase -> "Edge Functions" e ver se lá está ativado o `gemini-proxy`).*

---

## Passo 4: Sincronização Mobile (Android)

Como atualizámos dependências para evitar as incompatibilidades com o Capacitor 8:

1. Aguarda que o comando `npm install` (que ainda possa estar a correr no terminal) chegue até aos 100%.
2. Constrói as versões de visualização do código com:
   ```bash
   npm run build
   ```
3. Passa essa build construída para o ambiente móvel (Android) correndo:
   ```bash
   npx cap sync
   ```
4. Se quiseres simular o telemóvel Android, abre o estúdio:
   ```bash
   npx cap open android
   ```

**E pronto! Chegaste ao topo da montanha! 🏆 Após fazeres isto o Zenith tem o esqueleto impecável. É seguir viagem e lucrar.**
