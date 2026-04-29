BEGIN;
DROP POLICY IF EXISTS "rides: participantes actualizam corrida" ON public.rides;
DROP POLICY IF EXISTS "rides: passageiro ou motorista autenticado atualiza" ON public.rides;

CREATE POLICY "rides: participantes actualizam corrida"
  ON public.rides FOR UPDATE TO authenticated
  USING (passenger_id = auth.uid() OR driver_id = auth.uid())
  WITH CHECK (passenger_id = auth.uid() OR driver_id = auth.uid());
COMMIT;
