(function(){
  const sessionKey='sbiPaySessionStartedAt';
  const sessionDuration=24*60*60*1000;
  const authKeys=['sbiPayUsername','sbiPayProfile','sbiPayUserId','sbiPayInviteCode','sbiPaySessionStartedAt'];
  const readProfile=()=>{try{return JSON.parse(localStorage.getItem('sbiPayProfile')||'null')}catch(error){return null}};
  const startSession=profile=>{
    if(profile)localStorage.setItem('sbiPayProfile',JSON.stringify(profile));
    localStorage.setItem(sessionKey,String(Date.now()));
  };
  const clearSession=()=>authKeys.forEach(key=>localStorage.removeItem(key));
  const hasValidSession=()=>{
    const profile=readProfile();
    const startedAt=Number(localStorage.getItem(sessionKey));
    if(!profile?.id){clearSession();return false}
    if(!Number.isFinite(startedAt)){localStorage.setItem(sessionKey,String(Date.now()));return true}
    if(Date.now()-startedAt>=sessionDuration){clearSession();return false}
    return true;
  };
  const requireSession=()=>{if(!hasValidSession())window.location.href='login.html';return hasValidSession()};
  window.sbiPayAuth={startSession,clearSession,hasValidSession,requireSession,readProfile};
})();
