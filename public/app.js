const userId = localStorage.getItem('userId');
const userName = localStorage.getItem('userName');
if (!userId) { alert('Bitte zuerst einloggen'); location.href='/login.html'; }

const userInfo = document.getElementById('userInfo');
const userMenu = document.getElementById('userMenu');
const logoutBtn = document.getElementById('logoutBtn');
const dateTimeSpan = document.getElementById('currentDateTime');
userInfo.textContent = `Eingeloggt als: ${userName}`;

// Datum & Uhrzeit
function updateDateTime() {
  const now = new Date();
  dateTimeSpan.textContent = now.toLocaleDateString('de-DE') + ' ' + now.toLocaleTimeString('de-DE');
}
updateDateTime();
setInterval(updateDateTime, 1000);

// Menu
userInfo.addEventListener('click', ()=> userMenu.style.display = userMenu.style.display==='none'?'block':'none');
logoutBtn.addEventListener('click', ()=>{
  localStorage.removeItem('userId'); localStorage.removeItem('userName'); location.href='/login.html';
});
document.addEventListener('click', e=>{if(!userInfo.contains(e.target)&&!userMenu.contains(e.target)) userMenu.style.display='none';});

// Hilfsfunktionen
function escapeId(s){return s.replace(/[^a-z0-9_\-]/gi,'_');}

// Chart
let chart;
function renderChart(subjects){
  const labels = Object.keys(subjects);
  const data = labels.map(l=>subjects[l].count);
  const bgColors = labels.map(l=>{
    const c=subjects[l].count, g=subjects[l].goal;
    if(!g) return '#ccc';
    if(c<g) return '#ff9999';
    if(c===g) return '#99ff99';
    return '#9999ff';
  });
  const ctx=document.getElementById('chart').getContext('2d');
  if(chart) chart.destroy();
  chart = new Chart(ctx,{type:'bar', data:{labels, datasets:[{label:'Meldungen', data, backgroundColor:bgColors}]}});
}

// Render Subjects
function renderSubjects(subjects){
  const container=document.getElementById('subjects'); container.innerHTML='';
  if(Object.keys(subjects).length===0){container.innerHTML='<div>Keine Fächer</div>'; renderChart({}); return;}
  for(const name of Object.keys(subjects)){
    const obj = subjects[name];
    const div=document.createElement('div'); div.className='subject';
    // Hintergrundfarbe nach Ziel
    let bg='#fff';
    const count=obj.count, goal=obj.goal||0;
    if(goal>0){ bg=count<goal?'#ffcccc':count===goal?'#ccffcc':'#ccccff'; }
    div.style.background=bg;

    const info=document.createElement('div'); info.className='info';
    info.innerHTML=`<strong>${name}</strong> — Meldungen: <strong id="count-${escapeId(name)}">${count}</strong>`;

    const controls=document.createElement('div'); controls.className='controls';
    const minus=document.createElement('button'); minus.textContent='-1'; minus.onclick=()=>updateSubject(name,-1);
    const plus=document.createElement('button'); plus.textContent='+1'; plus.onclick=()=>updateSubject(name,1);
    const del=document.createElement('button'); del.textContent='Löschen'; del.style.background='#b00020'; del.onclick=()=>deleteSubject(name);
    const goalInput=document.createElement('input'); goalInput.type='number'; goalInput.min=0; goalInput.value=goal; goalInput.onchange=()=>updateGoal(name,goalInput.value);

    controls.append(minus, plus, del, goalInput);
    div.append(info,controls);
    container.appendChild(div);
  }
  renderChart(subjects);
}

// History
function renderHistory(history, subjects){
  const cal=document.getElementById('calendar'); cal.innerHTML='';
  const days=Object.keys(history).sort().reverse();
  if(days.length===0){ cal.innerHTML='<div>Keine historischen Meldungen</div>'; return; }
  for(const day of days){
    const div=document.createElement('div'); div.textContent=day; div.style.cursor='pointer';
    const details=document.createElement('div'); details.style.display='none'; details.style.padding='6px';
    for(const [name,count] of Object.entries(history[day])){
      const goal=(subjects[name]&&subjects[name].goal)||0;
      const line=document.createElement('div'); line.textContent=`${name}: ${count} (Ziel: ${goal})`;
      if(goal>0){ line.style.color=count<goal?'red':count===goal?'green':'blue'; }
      details.appendChild(line);
    }
    div.onclick=()=>{details.style.display=details.style.display==='none'?'block':'none';};
    cal.append(div,details);
  }
}

// Fetch
async function fetchSubjects(){
  const res=await fetch('/subjects?id='+encodeURIComponent(userId));
  const data=await res.json();
  renderSubjects(data.subjects||{});
  renderHistory(data.history||{},data.subjects||{});
}

// Add / Update / Goal / Delete
async function addSubject(name){await fetch('/subjects/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:userId,subject:name})}); await fetchSubjects();}
async function updateSubject(name,delta){await fetch('/subjects/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:userId,subject:name,delta})}); await fetchSubjects();}
async function updateGoal(name,goal){await fetch('/subjects/goal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:userId,subject:name,goal:Number(goal)})}); await fetchSubjects();}
async function deleteSubject(name){await fetch('/subjects/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:userId,subject:name})}); await fetchSubjects();}

// Form
document.getElementById('addForm').addEventListener('submit',e=>{
  e.preventDefault();
  const val=document.getElementById('subjectName').value.trim();
  if(val) addSubject(val); document.getElementById('subjectName').value='';
});

// Initial
fetchSubjects();
