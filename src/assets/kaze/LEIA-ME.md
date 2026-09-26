# Avatar do Kaze — o que é este ficheiro e como se troca

## O que está aqui

`kaze-avatar.glb` — o avatar 3D que dá cara ao Kaze no modo de Voz Ao Vivo.

## Licença: CC0 (domínio público)

Este modelo é o `mpfb.glb` do projecto **TalkingHead**, criado com o
[MPFB](https://static.makehumancommunity.org/mpfb.html) (extensão do Blender)
e licenciado **CC0 / domínio público**.

**O que isto significa na prática:**

- ✅ Pode ser usado num produto **comercial** (o Zenith Ride é comercial).
- ✅ **Não** exige atribuição.
- ✅ **Não** exige pedir autorização a ninguém.
- ✅ **Não** expira.

Ou seja: este ficheiro pode ficar aqui indefinidamente. Não é um problema
legal por resolver, é a escolha segura.

## ⚠️ O que NÃO se pode trocar

Os **outros** avatares do repositório do TalkingHead **não** são CC0. Se um dia
alguém for buscar um deles, isto é uma violação de licença:

| Ficheiro | Licença | Uso comercial |
|---|---|---|
| `mpfb.glb` (**o que está aqui**) | **CC0** | ✅ **Pode** |
| `brunette.glb` / `brunette-t.glb` | CC BY-NC 4.0 | ❌ **Proibido** |
| `vroid.glb` | VRoid — "non-commercial use" | ❌ **Proibido** |
| `avaturn.glb` | "non-commercial use" | ❌ **Proibido** |
| `avatarsdk.glb` | "non-commercial use" | ❌ **Proibido** |

O `brunette.glb` é o avatar de exemplo mais conhecido do TalkingHead e é o que
aparece em quase todos os tutoriais. **É uma armadilha** — parece livre, e não
é. Foi recusado explicitamente para este projecto por essa razão.

## Como trocar por um avatar próprio (a cara definitiva do Kaze)

1. Criar o avatar em <https://readyplayer.me/avatar/> (gratuito).
2. Copiar o **ID** do avatar (ex.: `64bfa15f0e72c63d7c3934a6`).
3. Descarregar o GLB com os morph targets **obrigatórios**:

```
https://models.readyplayer.me/<ID>.glb?morphTargets=ARKit,Oculus+Visemes,mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown&textureSizeLimit=1024&textureFormat=png
```

> ⚠️ Os parâmetros `morphTargets` **não podem ser removidos**. Sem os visemes
> Oculus, o avatar carrega mas fica com a boca fechada para sempre — sem erro
> nenhum no ecrã, que é a pior maneira de falhar.

4. Guardar por cima deste ficheiro, com o mesmo nome (`kaze-avatar.glb`).
5. Nada mais a fazer: o `KazeAvatar.tsx` lê daqui.

### Requisitos que o GLB tem de cumprir

Verificados por código em `src/components/KazeAvatar.tsx` — se faltar algum, o
avatar carrega e a boca fica parada, ou rebenta com `Blend shapes not found`:

- [ ] Node raiz com o nome **`Armature`** (é o `modelRoot` por defeito)
- [ ] Os **14 visemes Oculus**: `viseme_aa`, `viseme_E`, `viseme_I`,
      `viseme_O`, `viseme_U`, `viseme_PP`, `viseme_SS`, `viseme_TH`,
      `viseme_DD`, `viseme_FF`, `viseme_kk`, `viseme_nn`, `viseme_RR`,
      `viseme_CH`
- [ ] `eyeBlinkLeft` e `eyeBlinkRight` (para o piscar de olhos)
- [ ] Idealmente `jawOpen`, para dar volume à mandíbula

> **Como verificar antes de substituir.** Não basta olhar para o ficheiro num
> visualizador 3D — os visemes não aparecem como geometria separada. Correr o
> script `scripts/verificar-avatar.mjs`, que lê os nomes dos morph targets
> directamente do GLB e diz o que falta.

## Porque é que este avatar não fala sozinho

O `KazeAvatar` **não gera voz**. A voz vem do Gemini Live, como sempre veio. O
avatar só lê a energia dessa voz (`getOutputLevel()`) e move os visemes.

Isto é deliberado: a alternativa (`speakText` do TalkingHead) faria uma
**segunda** síntese de voz via Google TTS, com segunda chave, segundo custo e
uma voz diferente da `Aoede` que estava afinada. Analisar o áudio que já toca
é grátis e mantém a voz.

Ver o cabeçalho do `src/components/KazeAvatar.tsx` para o desenho completo.

## Histórico

- **26/09/2026** — Avatar criado. Escolhido o `mpfb.glb` (CC0) depois de o
  `brunette.glb` ser recusado por ser CC BY-NC 4.0 (proibido em uso comercial).
  Confirmados 66 morph targets, incluindo os 14 visemes Oculus, e o node
  `Armature`. Decisão de licença tomada pelo Dánio — ver `MEMORY.md`.
