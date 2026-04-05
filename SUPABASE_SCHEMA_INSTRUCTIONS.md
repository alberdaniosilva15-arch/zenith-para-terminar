Verificação e aplicação do `schema.sql` (Supabase)

Resumo rápido
- O ficheiro `schema.sql` já contém a trigger `handle_new_user` e o trigger `on_auth_user_created` que chama essa função. Vê [schema.sql](schema.sql#L164-L178).

Opções para aplicar/validar o schema no teu projeto Supabase

1) Usar o SQL Editor (recomendado, rápido)
- Abre a tua dashboard Supabase → Project → SQL Editor.
- Copia e cola o conteúdo de `schema.sql` e executa (Run).
- Para validar que a trigger existe, executa:

  SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created';

  Se retornar uma linha, o trigger está aí.

2) Usar o `supabase` CLI (se tiveres configurado)
- Autentica-te com `supabase login` e seleciona o projeto.
- Executa `supabase db push` (ou aplica as migrations que tenhas).

3) Validar via SQL (cheque de tabelas)
- Confirma que as tabelas existem:

  SELECT to_regclass('public.users');
  SELECT to_regclass('public.profiles');

O que faço já por ti
- Verifiquei localmente que `schema.sql` contém a trigger (linha indicada acima).
- Não apliquei alterações remotamente (preciso de acesso/service role ou que runs tu mesmos no SQL Editor).

Se quiseres que eu aplique o schema diretamente, diz-me como preferes:
- (A) Tu executas os passos no SQL Editor (posso guiar linha-a-linha).
- (B) Forneces credenciais temporárias (não recomendado por segurança) para eu executar — preferencialmente não. 

Notas de segurança
- Não coloques `SUPABASE_SERVICE_ROLE_KEY` no ficheiro `.env` do frontend; usa Secrets no dashboard ou variáveis de ambiente apenas em servidores.

Referências
- Ficheiro no repositório: [schema.sql](schema.sql#L1-L220)
