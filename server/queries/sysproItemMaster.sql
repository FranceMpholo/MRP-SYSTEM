WITH BomItemRoles AS (
    SELECT
        RoleRows.StockCode,
        MAX(RoleRows.IsBomParent) AS IsBomParent,
        MAX(RoleRows.IsBomComponent) AS IsBomComponent
    FROM (
        SELECT
            LTRIM(RTRIM(ParentPart)) AS StockCode,
            1 AS IsBomParent,
            0 AS IsBomComponent
        FROM dbo.BomStructure
        WHERE NULLIF(LTRIM(RTRIM(ParentPart)), '') IS NOT NULL

        UNION ALL

        SELECT
            LTRIM(RTRIM(Component)) AS StockCode,
            0 AS IsBomParent,
            1 AS IsBomComponent
        FROM dbo.BomStructure
        WHERE NULLIF(LTRIM(RTRIM(Component)), '') IS NOT NULL
    ) AS RoleRows
    GROUP BY RoleRows.StockCode
)
SELECT
    Roles.StockCode,
    LTRIM(RTRIM(Master.StockCode)) AS MasterStockCode,
    LTRIM(RTRIM(Master.Description)) AS Description,
    LTRIM(RTRIM(Master.StockUom)) AS StockUom,
    LTRIM(RTRIM(Master.PartCategory)) AS PartCategory,
    LTRIM(RTRIM(Master.ProductClass)) AS ProductClass,
    LTRIM(RTRIM(Master.StockOnHold)) AS StockOnHold,
    LTRIM(RTRIM(Master.StockOnHoldReason)) AS StockOnHoldReason,
    Master.SupercessionDate,
    Master.DateStkAdded,
    Roles.IsBomParent,
    Roles.IsBomComponent
FROM BomItemRoles AS Roles
LEFT JOIN dbo.InvMaster AS Master
    ON Master.StockCode = Roles.StockCode
ORDER BY Roles.StockCode;
