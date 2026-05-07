import sys
import re

with open('src/components/Login.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = '  return (\n    <div\n      className="min-h-screen'
end_marker = '  );\n};\n\nconst ZenithField: React.FC<{'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Markers not found!")
    sys.exit(1)

new_render = """  return (
    <div className="zr-shell">
      <div className="zr-app zr-app--login">
        <main className="zr-main" style={{ paddingTop: '20px', paddingBottom: '20px' }}>
          <section className="zr-card zr-card--hero">
            <div className="zr-inline" style={{ justifyContent: 'center', marginBottom: '16px' }}>
              <div className="zr-avatar zr-avatar--lg" style={{ background: 'transparent', border: 'none' }}>
                 <img src="/logo3d.png" alt="Zenith Ride" className="w-[70px] h-[70px] object-contain drop-shadow-[0_0_15px_rgba(230,195,100,0.4)]" />
              </div>
            </div>
            <p className="zr-kicker" style={{ textAlign: 'center' }}>Acesso Zenith</p>
            <h1 className="zr-title" style={{ textAlign: 'center' }}>Introduz as tuas<br/>credenciais</h1>
            <p className="zr-subtitle" style={{ textAlign: 'center' }}>
              Fluxo completo de entrada, registo, recuperação, redefinição, Google e escolha de papel.
            </p>
            <div className="zr-tabs" style={{ marginTop: '18px' }}>
              <button onClick={() => switchScreen('signin')} className={`zr-tab ${screen === 'signin' ? 'is-active' : ''}`}>Entrar</button>
              <button onClick={() => switchScreen('signup')} className={`zr-tab ${screen === 'signup' ? 'is-active' : ''}`}>Criar conta</button>
              <button onClick={() => switchScreen('forgot')} className={`zr-tab ${screen === 'forgot' ? 'is-active' : ''}`}>Recuperar</button>
            </div>

            <div className="zr-stack" style={{ marginTop: '18px' }}>
              {error && (
                <div className="zr-alert-box zr-alert-box--danger">
                  <p className="zr-note" style={{ color: '#fda4af' }}>{error}</p>
                </div>
              )}
              {success && (
                <div className="zr-alert-box zr-alert-box--success">
                  <p className="zr-note" style={{ color: '#86efac' }}>{success}</p>
                </div>
              )}

              {screen === 'signin' && (
                <section>
                  <p className="zr-label">Entrar como</p>
                  <div className="zr-role-grid">
                    <button onClick={() => setAuthRole(UserRole.PASSENGER)} className={`zr-role-card ${authRole === UserRole.PASSENGER || !authRole ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">person</span> Passageiro
                    </button>
                    <button onClick={() => setAuthRole(UserRole.DRIVER)} className={`zr-role-card ${authRole === UserRole.DRIVER ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">two_wheeler</span> Motorista
                    </button>
                    <button onClick={() => setAuthRole(UserRole.FLEET_OWNER)} className={`zr-role-card ${authRole === UserRole.FLEET_OWNER ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">apartment</span> Frota
                    </button>
                  </div>
                  <div className="zr-stack" style={{ marginTop: '16px' }}>
                    <div>
                      <label className="zr-label">Email</label>
                      <input className="zr-input" placeholder="exemplo@zenithride.ao" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    {isPasswordAuthRole && (
                      <div>
                        <label className="zr-label">Palavra-passe</label>
                        <input className="zr-input" type="password" placeholder="A tua palavra-passe" value={password} onChange={e => setPassword(e.target.value)} />
                      </div>
                    )}
                    {!isPasswordAuthRole && (
                      <p className="zr-copy">
                        Os passageiros entram com link mágico enviado por email.
                      </p>
                    )}
                    {isPasswordAuthRole ? (
                      <button onClick={handleSignIn} disabled={loading} className="zr-button zr-button--block">Entrar</button>
                    ) : (
                      <button onClick={handleSendMagicLink} disabled={loading} className="zr-button zr-button--block">Enviar link mágico</button>
                    )}
                    <button onClick={() => switchScreen('reset')} className="zr-button zr-button--ghost zr-button--block">
                      Redefinir password
                    </button>
                  </div>
                </section>
              )}

              {screen === 'signup' && (
                <section>
                  <p className="zr-label">Criar conta como</p>
                  <div className="zr-role-grid">
                    <button onClick={() => setRole(UserRole.PASSENGER)} className={`zr-role-card ${role === UserRole.PASSENGER ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">person</span> Passageiro
                    </button>
                    <button onClick={() => setRole(UserRole.DRIVER)} className={`zr-role-card ${role === UserRole.DRIVER ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">two_wheeler</span> Motorista
                    </button>
                    <button onClick={() => setRole(UserRole.FLEET_OWNER)} className={`zr-role-card ${role === UserRole.FLEET_OWNER ? 'is-active' : ''}`}>
                      <span className="material-symbols-outlined">apartment</span> Frota
                    </button>
                  </div>
                  <div className="zr-stack" style={{ marginTop: '16px' }}>
                    <div>
                      <label className="zr-label">Nome completo</label>
                      <input className="zr-input" placeholder="Mario Bento" value={name} onChange={e => setName(e.target.value)} />
                    </div>
                    <div>
                      <label className="zr-label">Email</label>
                      <input className="zr-input" placeholder="mario@zenithride.ao" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    {isPasswordRole && (
                      <div>
                        <label className="zr-label">Palavra-passe</label>
                        <input className="zr-input" type="password" placeholder="Mínimo de 6 caracteres" value={password} onChange={e => setPassword(e.target.value)} />
                      </div>
                    )}
                    {!isPasswordRole && (
                      <p className="zr-copy">
                        A tua conta de passageiro será criada e receberás um link mágico.
                      </p>
                    )}
                    <button onClick={handleSignUp} disabled={loading} className="zr-button zr-button--block">Criar conta</button>
                  </div>
                </section>
              )}

              {screen === 'forgot' && (
                <section>
                  <div className="zr-stack">
                    <div>
                      <label className="zr-label">Email de recuperação</label>
                      <input className="zr-input" placeholder="exemplo@zenithride.ao" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    <p className="zr-copy">
                      Iremos enviar um link para definires uma nova palavra-passe. Apenas para Motoristas e Frotas.
                    </p>
                    <button onClick={handleForgotPassword} disabled={loading} className="zr-button zr-button--block">Enviar recuperação</button>
                  </div>
                </section>
              )}

              {screen === 'reset' && (
                <section>
                  <div className="zr-stack">
                    <div>
                      <label className="zr-label">Nova palavra-passe</label>
                      <input className="zr-input" type="password" placeholder="Mínimo 6 caracteres" value={password} onChange={e => setPassword(e.target.value)} />
                    </div>
                    <div>
                      <label className="zr-label">Confirmar palavra-passe</label>
                      <input className="zr-input" type="password" placeholder="Repete a palavra-passe" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                    </div>
                    <button onClick={handleResetPassword} disabled={loading} className="zr-button zr-button--block">Atualizar password</button>
                  </div>
                </section>
              )}

            </div>
          </section>
        </main>
      </div>
    </div>
"""

new_content = content[:start_idx] + new_render + end_marker + content[end_idx + len(end_marker):]

with open('src/components/Login.tsx', 'w', encoding='utf-8') as f:
    f.write(new_content)
    
print("Updated Login.tsx render to match splash_auth.html exactly (safely)")
