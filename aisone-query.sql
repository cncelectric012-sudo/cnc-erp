SELECT
    CAST(a.PKGUID AS VARCHAR(50)) AS ErpID,
    a.CompanyName,
    ISNULL(a.Mobile1, ISNULL(a.Mobile2, ISNULL(a.Telephone1, a.Telephone2))) AS Phone,
    ISNULL(CAST(SUM(ISNULL(ag.CDebit,0)) - SUM(ISNULL(ag.CCredit,0)) AS DECIMAL(18,2)), 0) AS Outstanding,
    ISNULL(a.CreditLimit, 0) AS CreditLimit
FROM TBU_Accounts a
LEFT JOIN TBU_AccountAging ag ON ag.AccountDID = a.PKGUID
WHERE a.CompanyName IS NOT NULL AND LEN(LTRIM(RTRIM(a.CompanyName))) > 0
GROUP BY a.PKGUID, a.CompanyName, a.Mobile1, a.Mobile2, a.Telephone1, a.Telephone2, a.CreditLimit
ORDER BY a.CompanyName
