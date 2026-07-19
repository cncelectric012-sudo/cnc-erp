SELECT
    CAST(l.AccountDID AS VARCHAR(50)) AS erp_account_id,
    CONVERT(VARCHAR(10), l.VDate, 23) AS txn_date,
    CASE
        WHEN l.VoucherNo LIKE 'SI-%'  THEN 'Invoice'
        WHEN l.VoucherNo LIKE 'SR-%'  THEN 'Return'
        WHEN l.VoucherNo LIKE 'AOB-%' THEN 'Opening Balance'
        WHEN l.VoucherNo LIKE 'JV-%'  THEN 'Journal Voucher'
        WHEN l.VoucherNo LIKE 'BD-%'  THEN 'Payment'
        WHEN l.VoucherNo LIKE 'CR-%'  THEN 'Payment'
        ELSE 'Adjustment'
    END AS txn_type,
    ISNULL(l.CDebit, 0) AS debit,
    ISNULL(l.CCredit, 0) AS credit,
    l.VoucherNo AS voucher_no,
    ISNULL(l.Remarks, '') AS description
FROM TBI_AccountLedger l
JOIN TBU_Accounts a ON l.AccountDID = a.PKGUID
WHERE a.AccountCode LIKE '1-1-03-02%'
  AND a.CompanyName IS NOT NULL AND LEN(LTRIM(RTRIM(a.CompanyName))) > 0
  AND EXISTS (
    SELECT 1 FROM TBU_AccountsSegment asg
    WHERE asg.VMDID = a.PKGUID
    AND asg.SegmentDID IN (
      '20502C3C-F380-43B7-B76B-46FCB2742771',
      '6C135D33-5959-4306-A7B3-23E6C83F72A8'
    )
  )
ORDER BY l.AccountDID, l.VDate, l.AutoID
