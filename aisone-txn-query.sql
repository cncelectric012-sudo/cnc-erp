-- Sales Invoices (kab kitna buy kiya)
SELECT
    CAST(si.AccountDID AS VARCHAR(50)) AS erp_account_id,
    CONVERT(VARCHAR(10), si.VDate, 23) AS txn_date,
    'Invoice' AS txn_type,
    ISNULL(si.CGrandTotal, 0) AS amount,
    CAST(si.VNo AS VARCHAR(20)) AS voucher_no,
    ISNULL(si.Remarks, '') AS description
FROM TBU_SaleInvoice si
WHERE si.AccountDID IS NOT NULL AND si.VStatus <> 2
AND si.VDate >= DATEADD(YEAR, -3, GETDATE())

UNION ALL

-- Cash Receipts (cash payment received)
SELECT
    CAST(crv.AccountDID AS VARCHAR(50)) AS erp_account_id,
    CONVERT(VARCHAR(10), crv.VDate, 23) AS txn_date,
    'Payment' AS txn_type,
    ISNULL(crv.CAmount, 0) AS amount,
    CAST(crv.VNo AS VARCHAR(20)) AS voucher_no,
    ISNULL(crv.Remarks, '') AS description
FROM TBU_CashReceiveVoucher crv
WHERE crv.AccountDID IS NOT NULL AND crv.VStatus <> 2
AND crv.VDate >= DATEADD(YEAR, -3, GETDATE())

UNION ALL

-- Bank Deposits (cheque/bank payment received)
SELECT
    CAST(bdv.AccountDID AS VARCHAR(50)) AS erp_account_id,
    CONVERT(VARCHAR(10), bdv.VDate, 23) AS txn_date,
    'Payment' AS txn_type,
    ISNULL(bdv.CAmount, 0) AS amount,
    CAST(bdv.VNo AS VARCHAR(20)) AS voucher_no,
    ISNULL(bdv.Remarks, ISNULL(bdv.ChequeNo, '')) AS description
FROM TBU_BankDepositVoucher bdv
WHERE bdv.AccountDID IS NOT NULL AND bdv.VStatus <> 2
AND bdv.VDate >= DATEADD(YEAR, -3, GETDATE())

UNION ALL

-- Multiple Receiving Voucher Details (bulk receipts)
SELECT
    CAST(mrvd.AccountDID AS VARCHAR(50)) AS erp_account_id,
    CONVERT(VARCHAR(10), mrvd.TransDate, 23) AS txn_date,
    'Payment' AS txn_type,
    ISNULL(mrvd.CAmount, 0) AS amount,
    CAST(mrvd.TransNo AS VARCHAR(20)) AS voucher_no,
    ISNULL(mrvd.Remarks, '') AS description
FROM TBU_MultipleReceivingVouchersDetail mrvd
WHERE mrvd.AccountDID IS NOT NULL AND mrvd.VStatus <> 2
AND mrvd.TransDate >= DATEADD(YEAR, -3, GETDATE())

ORDER BY erp_account_id, txn_date
