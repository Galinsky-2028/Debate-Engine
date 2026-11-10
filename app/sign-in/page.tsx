"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "../../lib/auth/client";

export default function SignInPage() {
  const [create,setCreate]=useState(false);
  const [busy,setBusy]=useState(false);
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [name,setName]=useState("");
  const [message,setMessage]=useState("");
  const [verify,setVerify]=useState(false);
  const [otp,setOtp]=useState("");
  async function verifyEmail(event:FormEvent) {
    event.preventDefault();setBusy(true);setMessage("");
    try {
      const result=await authClient.emailOtp.verifyEmail({email,otp});
      if(result.error){setMessage(result.error.message||"Verification failed.");return;}
      window.location.assign("/workspace");
    } catch {setMessage("Could not verify your email. Please try again.");}
    finally {setBusy(false);}
  }
  async function sendCode() {
    setBusy(true);setMessage("");
    try {
      const result=await authClient.emailOtp.sendVerificationOtp({email,type:"email-verification"});
      setMessage(result.error?.message||"If your account needs verification, a code has been sent.");
      if(!result.error)setVerify(true);
    } catch {setMessage("Could not send a verification code. Please try again.");}
    finally {setBusy(false);}
  }
  async function googleSignIn() {
    setBusy(true);setMessage("");
    try {
      const result=await authClient.signIn.social({provider:"google",callbackURL:window.location.origin+"/workspace"});
      if(result.error)setMessage(result.error.message||"Google sign-in failed.");
    } catch {setMessage("Could not reach Google sign-in. Please try again.");}
    finally {setBusy(false);}
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true);setMessage("");
    try {
      const result = create ?
        await authClient.signUp.email({email,password,name}) :
        await authClient.signIn.email({email,password});
      if (result.error) {
        setMessage(result.error.message || "Authentication failed.");
        if(result.error.code==="EMAIL_NOT_VERIFIED")setVerify(true);
        return;
      }
      if(create&&result.data?.user&&!result.data.user.emailVerified){setVerify(true);setMessage("Enter the verification code sent to your email.");return;}
      window.location.assign("/workspace");
    } catch {
      setMessage("Could not reach the authentication service.");
    } finally { setBusy(false); }
  }
  return <div className="interior-page auth-page">
    <p className="eyebrow dark">CANDIDATE WORKSPACE</p>
    <h1>{create ? "Create your" : "Welcome"}<br/><em>{create ? "account." : "back."}</em></h1>
    <p className="interior-lead">Candidate registration is not candidate verification. Only verified candidates can publish official debate contributions.</p>
    <button type="button" className="button button-dark" disabled={busy} onClick={googleSignIn}>Continue with Google →</button>
    <p>Or use your email and password.</p>
    {verify?<form className="action-form" onSubmit={verifyEmail}>
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>Email verification code<input autoComplete="one-time-code" inputMode="numeric" required value={otp} onChange={e=>setOtp(e.target.value)} maxLength={10}/></label>
      {message&&<p role="status" className="form-alert">{message}</p>}
      <button className="button button-dark" disabled={busy}>Verify email →</button>
      <button type="button" className="link-button" disabled={busy} onClick={sendCode}>Resend verification code</button>
      <button type="button" className="link-button" onClick={()=>{setVerify(false);setMessage("");}}>Return to sign in</button>
    </form>:<form className="action-form" onSubmit={submit}>
      {create && <label>Display name<input autoComplete="name" required minLength={2} maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label>}
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>Password<input type="password" autoComplete={create?"new-password":"current-password"} required minLength={12} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {message && <p role="alert" className="form-alert">{message}</p>}
      <button className="button button-dark" disabled={busy}>{busy?"Working…":create?"Create account →":"Sign in →"}</button>
    </form>}
    {!verify&&<button className="link-button" onClick={()=>{setCreate(!create);setMessage("");}}>{create?"Already have an account? Sign in":"New here? Create an account"}</button>}
    {!verify&&<button className="link-button" disabled={busy||!email} onClick={sendCode}>Verify an existing email account</button>}
    <p><Link href="/debates" className="inline-arrow">Return to public debates ↗</Link></p>
  </div>;
}
