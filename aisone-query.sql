SELECT
    CAST(a.PKGUID AS VARCHAR(50)) AS ErpID,
    a.CompanyName,
    ISNULL(a.Mobile1, ISNULL(a.Mobile2, ISNULL(a.Telephone1, a.Telephone2))) AS Phone,
    ISNULL(
        (SELECT ISNULL(SUM(l.CDebit), 0) - ISNULL(SUM(l.CCredit), 0)
         FROM TBI_AccountLedger l WHERE l.AccountDID = a.PKGUID)
    , 0) AS Outstanding,
    ISNULL(a.CreditLimit, 0) AS CreditLimit
FROM TBU_Accounts a
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
ORDER BY a.CompanyName
