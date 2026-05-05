/* ═══════════════════════════════════════════════════════════════
   CNC ELECTRIC — Credit Analysis Engine
   ═══════════════════════════════════════════════════════════════ */

function computeCustomers() {
  const map = {};
  rows.forEach(r => {
    const c = (r.customer || r.name || 'Unknown').trim();
    (map[c] = map[c] || []).push(r);
  });
  customers = Object.entries(map)
    .map(([name, list]) => analyzeCustomer(name, list))
    .sort((a, b) => b.riskScore - a.riskScore);
}

function analyzeCustomer(name, list) {
  const p = policy;
  let totalSales = 0, totalPaid = 0, currentBalance = 0;
  let sales90 = 0, paid90 = 0, paid30 = 0;
  let oldest = 0, oldestInv = '', wtdNum = 0, wtdBase = 0;
  let invoiceCount = 0, receiptCount = 0, zeroRounds = 0;
  let prevDue = 0, peakBalance = 0;
  let balance90 = 0, balance30 = 0;
  let balance90set = false, balance30set = false;

  list.forEach(r => {
    const age = ageDays(r.date);
    const amount = num(r.amount);
    const paid = num(r.paid);
    const due = num(r.due);
    const isInvoice = amount > 0;
    const isReceipt = paid > 0;

    totalSales += amount;
    totalPaid += paid;
    peakBalance = Math.max(peakBalance, due);

    if (isInvoice) {
      invoiceCount++;
      wtdNum += amount * age;
      wtdBase += amount;
      if (due > 0 && age > oldest) { oldest = age; oldestInv = r.invoice; }
      if (age <= 90) sales90 += amount;
    }
    if (isReceipt) {
      receiptCount++;
      if (age <= 90) paid90 += paid;
      if (age <= 30) paid30 += paid;
    }
    if (due === 0 && prevDue > 0) zeroRounds++;
    prevDue = due;
    currentBalance = Math.max(currentBalance, due);

    if (age <= 90 && !balance90set) { balance90 = due; balance90set = true; }
    if (age <= 30 && !balance30set) { balance30 = due; balance30set = true; }
  });

  const lastRow = list[list.length - 1];
  currentBalance = num(lastRow && lastRow.due ? lastRow.due : currentBalance);

  const recovery = totalSales > 0 ? (totalPaid / totalSales * 100) : 100;
  const recRecent = sales90 > 0 ? (paid90 / sales90 * 100) : 100;
  const wtdDays = wtdBase > 0 ? wtdNum / wtdBase : 0;
  const monthlyRunRate = sales90 > 0 ? sales90 / 3 : totalSales / 12;
  const tenure = list.length > 0 ? ageDays(list[0].date) / 30 : 0;
  const freqPerMonth = tenure > 0 ? invoiceCount / tenure : 0;
  const consistency = invoiceCount > 0 ? zeroRounds / invoiceCount : 0;
  const balTrend90 = balance90 > 0 ? ((currentBalance - balance90) / balance90 * 100) : 0;

  // ── Risk Score ───────────────────────
  let agingSev = 0;
  if (currentBalance > 0) {
    const age90p = Math.max(0, currentBalance * 0.4);
    const age60 = currentBalance * 0.3;
    const age30 = currentBalance * 0.2;
    agingSev = Math.min(100, (age90p * 4 + age60 * 3 + age30 * 2) / currentBalance * 25);
  }
  const oldestScore = Math.min(100, oldest > 90 ? 100 : oldest > 60 ? 80 : oldest > 45 ? 60 : oldest > 30 ? 40 : oldest > 15 ? 20 : 0);
  const velScore    = Math.min(100, wtdDays > 90 ? 100 : wtdDays > 60 ? 80 : wtdDays > 45 ? 60 : wtdDays > 30 ? 40 : wtdDays > 15 ? 20 : 0);
  const trajScore   = Math.min(100, balTrend90 > 200 ? 100 : balTrend90 > 100 ? 80 : balTrend90 > 50 ? 60 : balTrend90 > 0 ? 30 : 0);
  const recScore    = Math.min(100, Math.max(0, (100 - recovery) * 2));
  const recRecentScore = Math.min(100, Math.max(0, (100 - recRecent) * 2));
  const peakScore   = peakBalance > 0 && currentBalance > 0 ? Math.min(100, (currentBalance / peakBalance) * 100) : 0;
  const returnScore = 0;

  const riskScore = Math.round(
    agingSev * 0.25 + oldestScore * 0.15 + velScore * 0.15 +
    trajScore * 0.15 + recScore * 0.10 + recRecentScore * 0.10 +
    peakScore * 0.05 + returnScore * 0.05
  );

  // ── Value Score ───────────────────────
  const annualVol  = (totalSales / Math.max(1, tenure)) * 12;
  const volScore   = Math.min(100, annualVol > 10000000 ? 100 : annualVol > 5000000 ? 80 : annualVol > 2000000 ? 60 : annualVol > 500000 ? 40 : annualVol > 100000 ? 20 : 0);
  const tenureScore= Math.min(100, tenure > 36 ? 100 : tenure > 24 ? 70 : tenure > 12 ? 40 : tenure > 6 ? 20 : 0);
  const freqScore  = Math.min(100, freqPerMonth > 10 ? 100 : freqPerMonth > 4 ? 60 : freqPerMonth > 1 ? 30 : 10);
  const consistScore = Math.min(100, consistency * 100);
  const divScore   = 50;
  const valueScore = Math.round(volScore * 0.40 + tenureScore * 0.20 + freqScore * 0.20 + consistScore * 0.10 + divScore * 0.10);

  const riskGrade = riskScore <= 20 ? 'A' : riskScore <= 40 ? 'B' : riskScore <= 70 ? 'C' : 'D';
  const volCat    = valueScore >= 70 ? '1' : valueScore >= 40 ? '2' : '3';
  const grade     = volCat + riskGrade;

  let zone = 'Green';
  if (oldest > 60 || recovery < 75) zone = 'Red';
  else if (oldest > 45 || recovery < 75 || wtdDays > 45) zone = 'Orange';
  else if (oldest > 30 || recovery < 90 || wtdDays > 20) zone = 'Yellow';

  const zoneFactor = zone === 'Green' ? 1 : zone === 'Yellow' ? 0.75 : zone === 'Orange' ? 0.5 : 0;
  const rawLimit = monthlyRunRate * (p.creditDays / 30);
  const creditLimit = rawLimit * zoneFactor;
  const utilization = creditLimit > 0 ? (currentBalance / creditLimit * 100) : (currentBalance > 0 ? 999 : 0);

  let pattern = 'Clean';
  if (recovery < 60) pattern = 'Ghost';
  else if (oldest > 90 && recovery < 85) pattern = 'Selective';
  else if (balTrend90 > 50 && recovery < 90) pattern = 'Rolling';
  else if (receiptCount > 0 && recovery > 90) pattern = 'Installment';

  const spKey = name.trim().toLowerCase();
  const spData = (window.spDB || {})[spKey];
  const salesperson = spData ? (spData.salesperson || spData.name || spData) : null;

  const clientInfo = (window.clientDB || {})[spKey] || {};

  return {
    name, list, totalSales, totalPaid, recovery, recRecent,
    currentBalance, creditLimit, utilization, monthlyRunRate,
    wtdDays, oldest, oldestInv, peakBalance, balTrend90,
    tenure, invoiceCount, receiptCount, zeroRounds,
    riskScore, valueScore, grade, riskGrade, volCat, zone,
    pattern, annualVol, freqPerMonth, consistency, salesperson,
    phone:         clientInfo.phone || '',
    address:       clientInfo.address || '',
    email:         clientInfo.email || '',
    contactPerson: clientInfo.contactPerson || '',
    creditApproved: clientInfo.creditApproved || ''
  };
}
