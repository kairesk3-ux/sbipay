(function(){
  const storageKey='sbiPayTransactions';
  const seededTransactions=[
    {id:'receive-inr-185324',code:'X6GsNb',type:'INR',currency:'INR',label:'Receive INR',direction:'receive',amount:100,status:'success',date:'2026-09-15T18:35:21'},
    {id:'receive-inr-135819',code:'4kcXwN',type:'INR',currency:'INR',label:'Receive INR',direction:'receive',amount:200,status:'success',date:'2026-09-15T14:16:09'},
    {id:'receive-inr-135649',code:'Q2bxDU',type:'INR',currency:'INR',label:'Receive INR',direction:'receive',amount:300,status:'success',date:'2026-09-15T14:08:50'},
    {id:'receive-inr-134405',code:'mK7T8L',type:'INR',currency:'INR',label:'Receive INR',direction:'receive',amount:150,status:'success',date:'2026-09-15T14:06:25'},
    {id:'receive-inr-134041',code:'NAYzIP',type:'INR',currency:'INR',label:'Receive INR',direction:'receive',amount:200,status:'success',date:'2026-09-15T14:04:41'},
    {id:'receive-inr-133439',code:'bk7qrx',type:'INR',currency:'INR',label:'Receive INR',direction:'receive',amount:50,status:'success',date:'2026-09-15T14:04:39'},
    {id:'purchase-inr-185324',code:'K6rdUM',type:'INR',currency:'INR',label:'Purchase INR',direction:'purchase',amount:1000,status:'failed',date:'2026-09-15T18:53:24'},
    {id:'purchase-inr-135819',code:'b8tLqH',type:'INR',currency:'INR',label:'Purchase INR',direction:'purchase',amount:1000,status:'failed',date:'2026-09-15T13:58:19'},
    {id:'purchase-inr-135649',code:'b8tLqH',type:'INR',currency:'INR',label:'Purchase INR',direction:'purchase',amount:1000,status:'failed',date:'2026-09-15T13:56:49'},
    {id:'purchase-inr-134405',code:'y85qJP',type:'INR',currency:'INR',label:'Purchase INR',direction:'purchase',amount:500,status:'failed',date:'2026-09-15T13:17:08'},
    {id:'purchase-usdt-220000',code:'YA1pEI',type:'USDT',currency:'USDT',label:'Purchase USDT',direction:'purchase',amount:22000,status:'failed',date:'2026-09-16T15:56:30'},
    {id:'purchase-usdt-11000',code:'iY82mK',type:'USDT',currency:'USDT',label:'Purchase USDT',direction:'purchase',amount:11000,status:'failed',date:'2026-09-16T15:55:00'},
    {id:'purchase-usdt-5000',code:'qP4nV2',type:'USDT',currency:'USDT',label:'Purchase USDT',direction:'purchase',amount:5000,status:'failed',date:'2026-09-16T15:54:12'},
    {id:'receive-usdt-1200',code:'Z8fGvT',type:'USDT',currency:'USDT',label:'Receive USDT',direction:'receive',amount:1200,status:'success',date:'2026-09-16T16:12:00'},
    {id:'receive-usdt-450',code:'R9kU1s',type:'USDT',currency:'USDT',label:'Receive USDT',direction:'receive',amount:450,status:'success',date:'2026-09-16T08:45:18'}
  ];
  const normalizeTransaction=transaction=>{
    const direction=transaction.direction||(/receive|withdraw|deposit/i.test(transaction.label||'')?'receive':'purchase');
    const currency=transaction.currency||transaction.type||'INR';
    return {...transaction,direction,type:transaction.type||currency,currency,amount:Number(transaction.amount||0)};
  };
  const demoTransactionIds=new Set(seededTransactions.map(transaction=>transaction.id));
  const read=()=>{
    try{
      const stored=JSON.parse(localStorage.getItem(storageKey)||'null');
      if(Array.isArray(stored)){
        const clean=stored.filter(transaction=>!demoTransactionIds.has(transaction.id)).map(normalizeTransaction);
        if(clean.length!==stored.length)localStorage.setItem(storageKey,JSON.stringify(clean));
        return clean;
      }
    }catch(error){}
    return [];
  };
  const write=transactions=>localStorage.setItem(storageKey,JSON.stringify(transactions));
  const add=transaction=>{
    const record={id:`${transaction.type||'order'}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,date:new Date().toISOString(),status:'processing',...normalizeTransaction(transaction)};
    const transactions=read();
    transactions.unshift(record);
    write(transactions);
    return record;
  };
  const formatDate=date=>new Date(date).toLocaleString('en-GB',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).replace(',','');
  const statusLabel=status=>{
    if(status==='cancelled')return 'Cancelled';
    if(status==='failed')return 'Failed';
    if(status==='timeout')return 'Timeout';
    if(status==='success')return 'Success';
    if(status==='processing')return 'Processing';
    return status ? status[0].toUpperCase()+status.slice(1) : 'Processing';
  };
  const amountLabel=record=>record.currency==='USDT'?`${Number(record.amount).toFixed(2)} USDT`:`₹ ${Number(record.amount).toFixed(2)}`;
  const accountSummary=()=>{
    const records=read().filter(record=>record.currency==='INR');
    const received=records.filter(record=>record.direction==='receive'&&record.status==='success').reduce((sum,record)=>sum+record.amount,0);
    const spent=records.filter(record=>record.direction==='purchase'&&record.status==='success').reduce((sum,record)=>sum+record.amount,0);
    const startingBalance=Number(localStorage.getItem('sbiPayStartingBalance')||0);
    const balance=Math.max(0,startingBalance+received-spent);
    return {balance,reward:balance*0.05,pending:records.filter(record=>record.status==='processing').reduce((sum,record)=>sum+record.amount,0)};
  };
  const buyerId=()=>{const key='sbiPayBuyerId';const existing=localStorage.getItem(key);if(existing)return existing;const id=`buyer-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;localStorage.setItem(key,id);return id};
  const readLocks=()=>{try{return JSON.parse(localStorage.getItem('sbiPayOrderLocks')||'{}')}catch(error){return {}}};
  const writeLocks=locks=>localStorage.setItem('sbiPayOrderLocks',JSON.stringify(locks));
  const lockOrder=(orderId,amount,seller)=>{const locks=readLocks();const now=Date.now();const existing=locks[orderId];if(existing&&existing.expiresAt>now&&existing.owner!==buyerId())return {locked:false,lock:existing};const lock={owner:buyerId(),orderId,amount,seller,expiresAt:now+30*60*1000};locks[orderId]=lock;writeLocks(locks);return {locked:true,lock};};
  const releaseOrder=orderId=>{const locks=readLocks();delete locks[orderId];writeLocks(locks)};
  const upsertPurchase=(orderId,amount,seller)=>{const records=read();let record=records.find(item=>item.orderId===orderId&&item.direction==='purchase');if(!record){record={id:`purchase-${orderId}`,orderId,code:orderId,type:'INR',currency:'INR',label:'Purchase INR',direction:'purchase',amount:Number(amount),status:'processing',seller,date:new Date().toISOString()};records.unshift(record);write(records)}return record;};
  const completePurchase=(orderId,utr)=>{const records=read();const record=records.find(item=>item.orderId===orderId&&item.direction==='purchase');if(!record)return null;record.status='success';record.utr=utr;record.completedAt=new Date().toISOString();write(records);const sales=JSON.parse(localStorage.getItem('sbiPaySellerSales')||'[]');sales.unshift({...record,status:'sold',sellerStatus:'Sold'});localStorage.setItem('sbiPaySellerSales',JSON.stringify(sales));const sellerBalance=Math.max(0,Number(localStorage.getItem('sbiPaySellerBalance')||0)-record.amount);localStorage.setItem('sbiPaySellerBalance',String(sellerBalance));releaseOrder(orderId);return record};
  const timeoutPurchase=orderId=>{const records=read();const record=records.find(item=>item.orderId===orderId&&item.direction==='purchase');if(!record)return null;record.status='timeout';write(records);releaseOrder(orderId);return record};
  const subscribe=callback=>{
    const refresh=()=>callback(read());
    window.addEventListener('storage',refresh);
    const timer=setInterval(refresh,1000);
    return()=>{window.removeEventListener('storage',refresh);clearInterval(timer)};
  };
  window.sbiPayTransactions={read,write,add,formatDate,statusLabel,amountLabel,accountSummary,buyerId,lockOrder,releaseOrder,upsertPurchase,completePurchase,timeoutPurchase,subscribe};
})();
