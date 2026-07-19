SELECT
    CAST(a.PKGUID AS VARCHAR(50)) AS ErpID,
    a.CompanyName,
    ISNULL(a.Mobile1, ISNULL(a.Mobile2, ISNULL(a.Telephone1, a.Telephone2))) AS Phone,
    ISNULL(
        (SELECT ISNULL(SUM(si.CGrandTotal), 0) FROM TBU_SaleInvoice si WHERE si.AccountDID = a.PKGUID AND si.VStatus <> 2)
        -
        (SELECT ISNULL(SUM(crv.CAmount), 0) FROM TBU_CashReceiveVoucher crv WHERE crv.AccountDID = a.PKGUID AND crv.VStatus <> 2)
        -
        (SELECT ISNULL(SUM(bdv.CAmount), 0) FROM TBU_BankDepositVoucher bdv WHERE bdv.AccountDID = a.PKGUID AND bdv.VStatus <> 2)
        -
        (SELECT ISNULL(SUM(mrvd.CAmount), 0) FROM TBU_MultipleReceivingVouchersDetail mrvd WHERE mrvd.AccountDID = a.PKGUID AND mrvd.VStatus <> 2)
    , 0) AS Outstanding,
    ISNULL(a.CreditLimit, 0) AS CreditLimit
FROM TBU_Accounts a
WHERE a.CompanyName IS NOT NULL AND LEN(LTRIM(RTRIM(a.CompanyName))) > 0
ORDER BY a.CompanyName
