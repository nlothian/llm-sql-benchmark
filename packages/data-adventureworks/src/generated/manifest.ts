// Auto-generated - do not edit. Run `npm run bundle-benchmark` to regenerate.

export const BENCHMARK_CATEGORIES = {
  "trivial": {
    "description": "Single table; simple SELECT; at most 2 columns; no aggregation or GROUP BY"
  },
  "easy": {
    "description": "Single table; may use GROUP BY and aggregate functions; no JOINs"
  },
  "medium": {
    "description": "Exactly 2 tables joined; GROUP BY with aggregates; may include calculated fields; no window functions or CTEs"
  },
  "hard": {
    "description": "3 or more tables joined, or uses window functions, or uses CTEs, or combines multiple complex features"
  }
} as const;

export const BENCHMARK_REGISTER_TABLES: string[] = [
  "CREATE VIEW Customer AS SELECT * FROM read_csv_auto('tables/Customer.csv')",
  "CREATE VIEW Date AS SELECT * FROM read_csv_auto('tables/Date.csv')",
  "CREATE VIEW Product AS SELECT * FROM read_csv_auto('tables/Product.csv')",
  "CREATE VIEW Reseller AS SELECT * FROM read_csv_auto('tables/Reseller.csv')",
  "CREATE VIEW Sales AS SELECT * FROM read_csv_auto('tables/Sales.csv')",
  "CREATE VIEW Sales_Order AS SELECT * FROM read_csv_auto('tables/Sales_Order.csv')",
  "CREATE VIEW Sales_Territory AS SELECT * FROM read_csv_auto('tables/Sales_Territory.csv')"
];

export const BENCHMARK_TABLE_FILES: string[] = [
  "tables/Customer.csv",
  "tables/Date.csv",
  "tables/Product.csv",
  "tables/Reseller.csv",
  "tables/Sales.csv",
  "tables/Sales_Order.csv",
  "tables/Sales_Territory.csv"
];

export const BENCHMARK_QUESTIONS = [
  {
    "id": 1,
    "question": "Show annual revenue, total cost, gross profit, gross margin percentage, and total order lines by fiscal year. Return columns: Fiscal Year, total_revenue, total_cost, gross_profit, gross_margin_pct, total_order_lines. Sort by Fiscal Year ascending.",
    "difficulty": "medium",
    "sql": "SELECT d.\"Fiscal Year\", ROUND(SUM(s.\"Sales Amount\"), 2) AS total_revenue, ROUND(SUM(s.\"Total Product Cost\"), 2) AS total_cost, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\"), 2) AS gross_profit, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\") / SUM(s.\"Sales Amount\") * 100, 1) AS gross_margin_pct, COUNT(DISTINCT s.SalesOrderLineKey) AS total_order_lines FROM Sales s JOIN Date d ON s.OrderDateKey = d.DateKey GROUP BY d.\"Fiscal Year\" ORDER BY d.\"Fiscal Year\"",
    "included_tables": [
      "Sales",
      "Date"
    ],
    "row_count": 3,
    "columns": [
      "Fiscal Year",
      "total_revenue",
      "total_cost",
      "gross_profit",
      "gross_margin_pct",
      "total_order_lines"
    ],
    "first_row": {
      "Fiscal Year": "FY2018",
      "total_revenue": 23860891.17,
      "total_cost": 20824957.6,
      "gross_profit": 3035933.57,
      "gross_margin_pct": 12.7,
      "total_order_lines": 10918
    }
  },
  {
    "id": 2,
    "question": "Compare the Reseller and Internet sales channels showing total revenue, revenue share percentage, number of distinct sales orders, order lines, average line amount, and gross margin percentage. Return columns: Channel, total_revenue, revenue_share_pct, total_orders, order_lines, avg_line_amount, gross_margin_pct. Sort by total_revenue descending.",
    "difficulty": "hard",
    "sql": "SELECT so.Channel, ROUND(SUM(s.\"Sales Amount\"), 2) AS total_revenue, ROUND(SUM(s.\"Sales Amount\") * 100.0 / (SELECT SUM(\"Sales Amount\") FROM Sales), 1) AS revenue_share_pct, COUNT(DISTINCT so.\"Sales Order\") AS total_orders, COUNT(*) AS order_lines, ROUND(AVG(s.\"Sales Amount\"), 2) AS avg_line_amount, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\") / SUM(s.\"Sales Amount\") * 100, 1) AS gross_margin_pct FROM Sales s JOIN Sales_Order so ON s.SalesOrderLineKey = so.SalesOrderLineKey GROUP BY so.Channel ORDER BY total_revenue DESC",
    "included_tables": [
      "Sales",
      "Sales_Order"
    ],
    "row_count": 2,
    "columns": [
      "Channel",
      "total_revenue",
      "revenue_share_pct",
      "total_orders",
      "order_lines",
      "avg_line_amount",
      "gross_margin_pct"
    ],
    "first_row": {
      "Channel": "Reseller",
      "total_revenue": 80450596.98,
      "revenue_share_pct": 73.3,
      "total_orders": 3796,
      "order_lines": 60855,
      "avg_line_amount": 1322,
      "gross_margin_pct": 0.6
    }
  },
  {
    "id": 3,
    "question": "Show revenue, revenue share percentage, units sold, gross profit, and gross margin percentage by product category. Return columns: Category, revenue, revenue_share_pct, units_sold, gross_profit, gross_margin_pct. Sort by revenue descending.",
    "difficulty": "hard",
    "sql": "SELECT p.Category, ROUND(SUM(s.\"Sales Amount\"), 2) AS revenue, ROUND(SUM(s.\"Sales Amount\") * 100.0 / SUM(SUM(s.\"Sales Amount\")) OVER (), 1) AS revenue_share_pct, SUM(s.\"Order Quantity\") AS units_sold, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\"), 2) AS gross_profit, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\") / SUM(s.\"Sales Amount\") * 100, 1) AS gross_margin_pct FROM Sales s JOIN Product p ON s.ProductKey = p.ProductKey GROUP BY p.Category ORDER BY revenue DESC",
    "included_tables": [
      "Sales",
      "Product"
    ],
    "row_count": 4,
    "columns": [
      "Category",
      "revenue",
      "revenue_share_pct",
      "units_sold",
      "gross_profit",
      "gross_margin_pct"
    ],
    "first_row": {
      "Category": "Bikes",
      "revenue": 94620526.21,
      "revenue_share_pct": 86.2,
      "units_sold": 90220,
      "gross_profit": 10515096.61,
      "gross_margin_pct": 11.1
    }
  },
  {
    "id": 4,
    "question": "List the top 10 products by revenue, showing product name, category, subcategory, revenue, units sold, gross profit, and margin percentage. Return columns: Product, Category, Subcategory, revenue, units_sold, gross_profit, margin_pct. Sort by revenue descending, limit to 10 rows.",
    "difficulty": "medium",
    "sql": "SELECT p.Product, p.Category, p.Subcategory, ROUND(SUM(s.\"Sales Amount\"), 2) AS revenue, SUM(s.\"Order Quantity\") AS units_sold, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\"), 2) AS gross_profit, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\") / SUM(s.\"Sales Amount\") * 100, 1) AS margin_pct FROM Sales s JOIN Product p ON s.ProductKey = p.ProductKey GROUP BY p.Product, p.Category, p.Subcategory ORDER BY revenue DESC LIMIT 10",
    "included_tables": [
      "Sales",
      "Product"
    ],
    "row_count": 10,
    "columns": [
      "Product",
      "Category",
      "Subcategory",
      "revenue",
      "units_sold",
      "gross_profit",
      "margin_pct"
    ],
    "first_row": {
      "Product": "Mountain-200 Black, 38",
      "Category": "Bikes",
      "Subcategory": "Mountain Bikes",
      "revenue": 4400592.8,
      "units_sold": 2977,
      "gross_profit": 872822.12,
      "margin_pct": 19.8
    }
  },
  {
    "id": 5,
    "question": "Show revenue and units sold broken down by territory group, country, region, and fiscal year. Return columns: Group, Country, Region, Fiscal Year, revenue, units_sold. Sort by Group, Country, Region, then Fiscal Year all ascending.",
    "difficulty": "hard",
    "sql": "SELECT t.\"Group\", t.Country, t.Region, d.\"Fiscal Year\", ROUND(SUM(s.\"Sales Amount\"), 2) AS revenue, SUM(s.\"Order Quantity\") AS units_sold FROM Sales s JOIN Sales_Territory t ON s.SalesTerritoryKey = t.SalesTerritoryKey JOIN Date d ON s.OrderDateKey = d.DateKey GROUP BY t.\"Group\", t.Country, t.Region, d.\"Fiscal Year\" ORDER BY t.\"Group\", t.Country, t.Region, d.\"Fiscal Year\"",
    "included_tables": [
      "Sales",
      "Sales_Territory",
      "Date"
    ],
    "row_count": 30,
    "columns": [
      "Group",
      "Country",
      "Region",
      "Fiscal Year",
      "revenue",
      "units_sold"
    ],
    "first_row": {
      "Group": "Europe",
      "Country": "France",
      "Region": "France",
      "Fiscal Year": "FY2018",
      "revenue": 456703.71,
      "units_sold": 163
    }
  },
  {
    "id": 6,
    "question": "List the top 15 direct customers (excluding CustomerKey -1) by lifetime revenue, showing customer name, city, state/province, country/region, total orders, total line items, total units, lifetime revenue, and lifetime profit. Return columns: Customer, City, State-Province, Country-Region, total_orders, total_line_items, total_units, lifetime_revenue, lifetime_profit. Sort by lifetime_revenue descending, limit to 15 rows.",
    "difficulty": "hard",
    "sql": "SELECT c.Customer, c.City, c.\"State-Province\", c.\"Country-Region\", COUNT(DISTINCT so.\"Sales Order\") AS total_orders, COUNT(*) AS total_line_items, SUM(s.\"Order Quantity\") AS total_units, ROUND(SUM(s.\"Sales Amount\"), 2) AS lifetime_revenue, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\"), 2) AS lifetime_profit FROM Sales s JOIN Customer c ON s.CustomerKey = c.CustomerKey JOIN Sales_Order so ON s.SalesOrderLineKey = so.SalesOrderLineKey WHERE s.CustomerKey <> -1 GROUP BY c.Customer, c.City, c.\"State-Province\", c.\"Country-Region\" ORDER BY lifetime_revenue DESC LIMIT 15",
    "included_tables": [
      "Sales",
      "Customer",
      "Sales_Order"
    ],
    "row_count": 15,
    "columns": [
      "Customer",
      "City",
      "State-Province",
      "Country-Region",
      "total_orders",
      "total_line_items",
      "total_units",
      "lifetime_revenue",
      "lifetime_profit"
    ],
    "first_row": {
      "Customer": "Nichole Nara",
      "City": "Saint-Denis",
      "State-Province": "Seine Saint Denis",
      "Country-Region": "France",
      "total_orders": 5,
      "total_line_items": 13,
      "total_units": 13,
      "lifetime_revenue": 13295.38,
      "lifetime_profit": 5250.42
    }
  },
  {
    "id": 7,
    "question": "For the Reseller channel only, show reseller count, total revenue, revenue per reseller, gross profit, and margin percentage by business type. Return columns: Business Type, reseller_count, total_revenue, revenue_per_reseller, gross_profit, margin_pct. Sort by total_revenue descending.",
    "difficulty": "hard",
    "sql": "SELECT r.\"Business Type\", COUNT(DISTINCT r.ResellerKey) AS reseller_count, ROUND(SUM(s.\"Sales Amount\"), 2) AS total_revenue, ROUND(SUM(s.\"Sales Amount\") / COUNT(DISTINCT r.ResellerKey), 2) AS revenue_per_reseller, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\"), 2) AS gross_profit, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\") / SUM(s.\"Sales Amount\") * 100, 1) AS margin_pct FROM Sales s JOIN Reseller r ON s.ResellerKey = r.ResellerKey JOIN Sales_Order so ON s.SalesOrderLineKey = so.SalesOrderLineKey WHERE so.Channel = 'Reseller' GROUP BY r.\"Business Type\" ORDER BY total_revenue DESC",
    "included_tables": [
      "Sales",
      "Reseller",
      "Sales_Order"
    ],
    "row_count": 3,
    "columns": [
      "Business Type",
      "reseller_count",
      "total_revenue",
      "revenue_per_reseller",
      "gross_profit",
      "margin_pct"
    ],
    "first_row": {
      "Business Type": "Warehouse",
      "reseller_count": 219,
      "total_revenue": 38726913.48,
      "revenue_per_reseller": 176835.22,
      "gross_profit": -4789.98,
      "margin_pct": 0
    }
  },
  {
    "id": 8,
    "question": "Show monthly revenue, number of distinct sales orders, and units sold for each month. Return columns: Month, MonthKey, monthly_revenue, orders, units_sold. Sort by MonthKey ascending.",
    "difficulty": "hard",
    "sql": "SELECT d.Month, d.MonthKey, ROUND(SUM(s.\"Sales Amount\"), 2) AS monthly_revenue, COUNT(DISTINCT so.\"Sales Order\") AS orders, SUM(s.\"Order Quantity\") AS units_sold FROM Sales s JOIN Date d ON s.OrderDateKey = d.DateKey JOIN Sales_Order so ON s.SalesOrderLineKey = so.SalesOrderLineKey GROUP BY d.Month, d.MonthKey ORDER BY d.MonthKey",
    "included_tables": [
      "Sales",
      "Date",
      "Sales_Order"
    ],
    "row_count": 36,
    "columns": [
      "Month",
      "MonthKey",
      "monthly_revenue",
      "orders",
      "units_sold"
    ],
    "first_row": {
      "Month": "2017 Jul",
      "MonthKey": 201707,
      "monthly_revenue": 1423357.32,
      "orders": 327,
      "units_sold": 1109
    }
  },
  {
    "id": 9,
    "question": "Show order lines, revenue, units sold, revenue per unit (total revenue ÷ total units sold), average list price per product in the subcategory, gross profit, and margin percentage for each product subcategory. Return columns: Subcategory, order_lines, revenue, units_sold, revenue_per_unit, avg_list_price, gross_profit, margin_pct. Sort by revenue descending.",
    "difficulty": "hard",
    "sql": "SELECT p.Subcategory, COUNT(*) AS order_lines, ROUND(SUM(s.\"Sales Amount\"), 2) AS revenue, SUM(s.\"Order Quantity\") AS units_sold, ROUND(SUM(s.\"Sales Amount\") / SUM(s.\"Order Quantity\"), 2) AS revenue_per_unit, ROUND(sub.avg_list_price, 2) AS avg_list_price, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\"), 2) AS gross_profit, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\") / SUM(s.\"Sales Amount\") * 100, 1) AS margin_pct FROM Sales s JOIN Product p ON s.ProductKey = p.ProductKey JOIN (SELECT Subcategory, AVG(\"List Price\") AS avg_list_price FROM Product GROUP BY Subcategory) sub ON p.Subcategory = sub.Subcategory GROUP BY p.Subcategory, sub.avg_list_price ORDER BY revenue DESC",
    "included_tables": [
      "Sales",
      "Product"
    ],
    "row_count": 35,
    "columns": [
      "Subcategory",
      "order_lines",
      "revenue",
      "units_sold",
      "revenue_per_unit",
      "avg_list_price",
      "gross_profit",
      "margin_pct"
    ],
    "first_row": {
      "Subcategory": "Road Bikes",
      "order_lines": 20918,
      "revenue": 43878791,
      "units_sold": 47148,
      "revenue_per_unit": 930.66,
      "avg_list_price": 1430.61,
      "gross_profit": 4364902.75,
      "margin_pct": 9.9
    }
  },
  {
    "id": 10,
    "question": "Show year-over-year revenue growth by channel and product category, comparing consecutive fiscal years. Return columns: Channel, Category, prior_year, prior_revenue, current_year, current_revenue, yoy_growth_pct. Sort by Channel, Category, then prior_year all ascending.",
    "difficulty": "hard",
    "sql": "WITH yearly AS (SELECT so.Channel, p.Category, d.\"Fiscal Year\", ROUND(SUM(s.\"Sales Amount\"), 2) AS revenue FROM Sales s JOIN Sales_Order so ON s.SalesOrderLineKey = so.SalesOrderLineKey JOIN Product p ON s.ProductKey = p.ProductKey JOIN Date d ON s.OrderDateKey = d.DateKey GROUP BY so.Channel, p.Category, d.\"Fiscal Year\"), with_prior AS (SELECT Channel, Category, LAG(\"Fiscal Year\") OVER (PARTITION BY Channel, Category ORDER BY \"Fiscal Year\") AS prior_year, LAG(revenue) OVER (PARTITION BY Channel, Category ORDER BY \"Fiscal Year\") AS prior_revenue, \"Fiscal Year\" AS current_year, revenue AS current_revenue FROM yearly) SELECT Channel, Category, prior_year, prior_revenue, current_year, current_revenue, ROUND((current_revenue - prior_revenue) / prior_revenue * 100, 1) AS yoy_growth_pct FROM with_prior WHERE prior_year IS NOT NULL ORDER BY Channel, Category, prior_year",
    "included_tables": [
      "Sales",
      "Sales_Order",
      "Product",
      "Date"
    ],
    "row_count": 12,
    "columns": [
      "Channel",
      "Category",
      "prior_year",
      "prior_revenue",
      "current_year",
      "current_revenue",
      "yoy_growth_pct"
    ],
    "first_row": {
      "Channel": "Internet",
      "Category": "Accessories",
      "prior_year": "FY2019",
      "prior_revenue": 14468.2,
      "current_year": "FY2020",
      "current_revenue": 686291.76,
      "yoy_growth_pct": 4643.4
    }
  },
  {
    "id": 11,
    "question": "Show the number of products, average list price, minimum list price, and maximum list price for each product category. Return columns: Category, product_count, avg_list_price, min_list_price, max_list_price. Sort by product_count descending.",
    "difficulty": "easy",
    "sql": "SELECT Category, COUNT(*) AS product_count, ROUND(AVG(\"List Price\"), 2) AS avg_list_price, ROUND(MIN(\"List Price\"), 2) AS min_list_price, ROUND(MAX(\"List Price\"), 2) AS max_list_price FROM Product GROUP BY Category ORDER BY product_count DESC",
    "included_tables": [
      "Product"
    ],
    "row_count": 4,
    "columns": [
      "Category",
      "product_count",
      "avg_list_price",
      "min_list_price",
      "max_list_price"
    ],
    "first_row": {
      "Category": "Components",
      "product_count": 189,
      "avg_list_price": 551.11,
      "min_list_price": 20.24,
      "max_list_price": 1431.5
    }
  },
  {
    "id": 12,
    "question": "Show the number of resellers, number of distinct business types, and number of distinct states/provinces for each country. Return columns: Country-Region, reseller_count, business_type_count, state_count. Sort by reseller_count descending.",
    "difficulty": "easy",
    "sql": "SELECT \"Country-Region\", COUNT(*) AS reseller_count, COUNT(DISTINCT \"Business Type\") AS business_type_count, COUNT(DISTINCT \"State-Province\") AS state_count FROM Reseller GROUP BY \"Country-Region\" ORDER BY reseller_count DESC",
    "included_tables": [
      "Reseller"
    ],
    "row_count": 7,
    "columns": [
      "Country-Region",
      "reseller_count",
      "business_type_count",
      "state_count"
    ],
    "first_row": {
      "Country-Region": "United States",
      "reseller_count": 427,
      "business_type_count": 3,
      "state_count": 35
    }
  },
  {
    "id": 13,
    "question": "List all distinct product categories. Return columns: Category. Sort by Category ascending.",
    "difficulty": "trivial",
    "sql": "SELECT DISTINCT Category FROM Product ORDER BY Category",
    "included_tables": [
      "Product"
    ],
    "row_count": 4,
    "columns": [
      "Category"
    ],
    "first_row": {
      "Category": "Accessories"
    }
  },
  {
    "id": 14,
    "question": "List all distinct product colors. Return columns: Color. Sort by Color ascending.",
    "difficulty": "trivial",
    "sql": "SELECT DISTINCT Color FROM Product ORDER BY Color",
    "included_tables": [
      "Product"
    ],
    "row_count": 10,
    "columns": [
      "Color"
    ],
    "first_row": {
      "Color": "Black"
    }
  },
  {
    "id": 15,
    "question": "List all sales territory regions and their countries. Return columns: Region, Country. Sort by Region ascending.",
    "difficulty": "trivial",
    "sql": "SELECT Region, Country FROM Sales_Territory ORDER BY Region",
    "included_tables": [
      "Sales_Territory"
    ],
    "row_count": 11,
    "columns": [
      "Region",
      "Country"
    ],
    "first_row": {
      "Region": "Australia",
      "Country": "Australia"
    }
  },
  {
    "id": 16,
    "question": "List all distinct fiscal years. Return columns: Fiscal Year. Sort by Fiscal Year ascending.",
    "difficulty": "trivial",
    "sql": "SELECT DISTINCT \"Fiscal Year\" FROM Date ORDER BY \"Fiscal Year\"",
    "included_tables": [
      "Date"
    ],
    "row_count": 4,
    "columns": [
      "Fiscal Year"
    ],
    "first_row": {
      "Fiscal Year": "FY2018"
    }
  },
  {
    "id": 17,
    "question": "List all distinct sales channels. Return columns: Channel. Sort by Channel ascending.",
    "difficulty": "trivial",
    "sql": "SELECT DISTINCT Channel FROM Sales_Order ORDER BY Channel",
    "included_tables": [
      "Sales_Order"
    ],
    "row_count": 2,
    "columns": [
      "Channel"
    ],
    "first_row": {
      "Channel": "Internet"
    }
  },
  {
    "id": 18,
    "question": "List all distinct customer countries. Return columns: Country-Region. Sort by Country-Region ascending.",
    "difficulty": "trivial",
    "sql": "SELECT DISTINCT \"Country-Region\" FROM Customer ORDER BY \"Country-Region\"",
    "included_tables": [
      "Customer"
    ],
    "row_count": 7,
    "columns": [
      "Country-Region"
    ],
    "first_row": {
      "Country-Region": "Australia"
    }
  },
  {
    "id": 19,
    "question": "List all distinct reseller business types. Return columns: Business Type. Sort by Business Type ascending.",
    "difficulty": "trivial",
    "sql": "SELECT DISTINCT \"Business Type\" FROM Reseller ORDER BY \"Business Type\"",
    "included_tables": [
      "Reseller"
    ],
    "row_count": 4,
    "columns": [
      "Business Type"
    ],
    "first_row": {
      "Business Type": "Specialty Bike Shop"
    }
  },
  {
    "id": 20,
    "question": "List all distinct fiscal quarters. Return columns: Fiscal Quarter. Sort by Fiscal Quarter ascending.",
    "difficulty": "trivial",
    "sql": "SELECT DISTINCT \"Fiscal Quarter\" FROM Date ORDER BY \"Fiscal Quarter\"",
    "included_tables": [
      "Date"
    ],
    "row_count": 16,
    "columns": [
      "Fiscal Quarter"
    ],
    "first_row": {
      "Fiscal Quarter": "FY2018 Q1"
    }
  },
  {
    "id": 21,
    "question": "Show total revenue, units sold, revenue per unit (total revenue ÷ total units sold), average list price per product in the category, realized discount percentage versus that average list price, gross profit, and margin percentage by sales channel and product category. Return columns: Channel, Category, total_revenue, units_sold, revenue_per_unit, avg_list_price, realized_discount_pct, gross_profit, margin_pct. Sort by Channel ascending, then total_revenue descending.",
    "difficulty": "hard",
    "sql": "WITH category_list AS (SELECT Category, AVG(\"List Price\") AS avg_list_price FROM Product GROUP BY Category) SELECT so.Channel, p.Category, ROUND(SUM(s.\"Sales Amount\"), 2) AS total_revenue, SUM(s.\"Order Quantity\") AS units_sold, ROUND(SUM(s.\"Sales Amount\") / SUM(s.\"Order Quantity\"), 2) AS revenue_per_unit, ROUND(cl.avg_list_price, 2) AS avg_list_price, ROUND((cl.avg_list_price - SUM(s.\"Sales Amount\") / SUM(s.\"Order Quantity\")) / cl.avg_list_price * 100, 1) AS realized_discount_pct, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\"), 2) AS gross_profit, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\") / SUM(s.\"Sales Amount\") * 100, 1) AS margin_pct FROM Sales s JOIN Sales_Order so ON s.SalesOrderLineKey = so.SalesOrderLineKey JOIN Product p ON s.ProductKey = p.ProductKey JOIN category_list cl ON p.Category = cl.Category GROUP BY so.Channel, p.Category, cl.avg_list_price ORDER BY so.Channel, total_revenue DESC",
    "included_tables": [
      "Sales",
      "Sales_Order",
      "Product"
    ],
    "row_count": 7,
    "columns": [
      "Channel",
      "Category",
      "total_revenue",
      "units_sold",
      "revenue_per_unit",
      "avg_list_price",
      "realized_discount_pct",
      "gross_profit",
      "margin_pct"
    ],
    "first_row": {
      "Channel": "Internet",
      "Category": "Bikes",
      "total_revenue": 28318144.65,
      "units_sold": 15205,
      "revenue_per_unit": 1862.42,
      "avg_list_price": 1524.59,
      "realized_discount_pct": -22.2,
      "gross_profit": 11505796.5,
      "margin_pct": 40.6
    }
  },
  {
    "id": 22,
    "question": "Show quarter-over-quarter revenue growth by channel and product category, comparing consecutive fiscal quarters. Return columns: Channel, Category, prior_quarter, prior_revenue, current_quarter, current_revenue, qoq_growth_pct. Sort by Channel, Category, then prior_quarter all ascending.",
    "difficulty": "hard",
    "sql": "WITH quarterly AS (SELECT so.Channel, p.Category, d.\"Fiscal Quarter\", MIN(d.MonthKey) AS quarter_key, ROUND(SUM(s.\"Sales Amount\"), 2) AS revenue FROM Sales s JOIN Sales_Order so ON s.SalesOrderLineKey = so.SalesOrderLineKey JOIN Product p ON s.ProductKey = p.ProductKey JOIN Date d ON s.OrderDateKey = d.DateKey GROUP BY so.Channel, p.Category, d.\"Fiscal Quarter\"), with_prior AS (SELECT Channel, Category, LAG(\"Fiscal Quarter\") OVER (PARTITION BY Channel, Category ORDER BY quarter_key) AS prior_quarter, LAG(revenue) OVER (PARTITION BY Channel, Category ORDER BY quarter_key) AS prior_revenue, \"Fiscal Quarter\" AS current_quarter, revenue AS current_revenue FROM quarterly) SELECT Channel, Category, prior_quarter, prior_revenue, current_quarter, current_revenue, ROUND((current_revenue - prior_revenue) / prior_revenue * 100, 1) AS qoq_growth_pct FROM with_prior WHERE prior_quarter IS NOT NULL ORDER BY Channel, Category, prior_quarter",
    "included_tables": [
      "Sales",
      "Sales_Order",
      "Product",
      "Date"
    ],
    "row_count": 63,
    "columns": [
      "Channel",
      "Category",
      "prior_quarter",
      "prior_revenue",
      "current_quarter",
      "current_revenue",
      "qoq_growth_pct"
    ],
    "first_row": {
      "Channel": "Internet",
      "Category": "Accessories",
      "prior_quarter": "FY2019 Q4",
      "prior_revenue": 14468.2,
      "current_quarter": "FY2020 Q1",
      "current_revenue": 158801.5,
      "qoq_growth_pct": 997.6
    }
  },
  {
    "id": 23,
    "question": "For each product category, list the top 2 subcategories by revenue, showing revenue rank within the category, revenue, units sold, gross profit, and revenue share percentage within the category. Return columns: Category, revenue_rank, Subcategory, revenue, units_sold, gross_profit, category_revenue_share_pct. Sort by Category, revenue_rank, then Subcategory all ascending.",
    "difficulty": "hard",
    "sql": "WITH subcategory_perf AS (SELECT p.Category, p.Subcategory, ROUND(SUM(s.\"Sales Amount\"), 2) AS revenue, SUM(s.\"Order Quantity\") AS units_sold, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\"), 2) AS gross_profit FROM Sales s JOIN Product p ON s.ProductKey = p.ProductKey GROUP BY p.Category, p.Subcategory), ranked AS (SELECT Category, Subcategory, revenue, units_sold, gross_profit, ROW_NUMBER() OVER (PARTITION BY Category ORDER BY revenue DESC, Subcategory ASC) AS revenue_rank, ROUND(revenue * 100.0 / SUM(revenue) OVER (PARTITION BY Category), 1) AS category_revenue_share_pct FROM subcategory_perf) SELECT Category, revenue_rank, Subcategory, revenue, units_sold, gross_profit, category_revenue_share_pct FROM ranked WHERE revenue_rank <= 2 ORDER BY Category, revenue_rank, Subcategory",
    "included_tables": [
      "Sales",
      "Product"
    ],
    "row_count": 8,
    "columns": [
      "Category",
      "revenue_rank",
      "Subcategory",
      "revenue",
      "units_sold",
      "gross_profit",
      "category_revenue_share_pct"
    ],
    "first_row": {
      "Category": "Accessories",
      "revenue_rank": 1,
      "Subcategory": "Helmets",
      "revenue": 484048.53,
      "units_sold": 19541,
      "gross_profit": 226406.73,
      "category_revenue_share_pct": 38.1
    }
  },
  {
    "id": 24,
    "question": "Within each sales channel, show revenue, revenue share percentage, cumulative revenue share percentage ordered by revenue descending, number of distinct sales orders, and gross profit by product category. Return columns: Channel, Category, revenue, channel_revenue_share_pct, cumulative_channel_revenue_share_pct, orders, gross_profit. Sort by Channel ascending, then revenue descending, then Category ascending.",
    "difficulty": "hard",
    "sql": "WITH category_perf AS (SELECT so.Channel, p.Category, ROUND(SUM(s.\"Sales Amount\"), 2) AS revenue, COUNT(DISTINCT so.\"Sales Order\") AS orders, ROUND(SUM(s.\"Sales Amount\" - s.\"Total Product Cost\"), 2) AS gross_profit FROM Sales s JOIN Sales_Order so ON s.SalesOrderLineKey = so.SalesOrderLineKey JOIN Product p ON s.ProductKey = p.ProductKey GROUP BY so.Channel, p.Category) SELECT Channel, Category, revenue, ROUND(revenue * 100.0 / SUM(revenue) OVER (PARTITION BY Channel), 1) AS channel_revenue_share_pct, ROUND(SUM(revenue) OVER (PARTITION BY Channel ORDER BY revenue DESC, Category ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) * 100.0 / SUM(revenue) OVER (PARTITION BY Channel), 1) AS cumulative_channel_revenue_share_pct, orders, gross_profit FROM category_perf ORDER BY Channel, revenue DESC, Category ASC",
    "included_tables": [
      "Sales",
      "Sales_Order",
      "Product"
    ],
    "row_count": 7,
    "columns": [
      "Channel",
      "Category",
      "revenue",
      "channel_revenue_share_pct",
      "cumulative_channel_revenue_share_pct",
      "orders",
      "gross_profit"
    ],
    "first_row": {
      "Channel": "Internet",
      "Category": "Bikes",
      "revenue": 28318144.65,
      "channel_revenue_share_pct": 96.5,
      "cumulative_channel_revenue_share_pct": 96.5,
      "orders": 15205,
      "gross_profit": 11505796.5
    }
  },
  {
    "id": 25,
    "question": "For each territory group and fiscal year, show the top sales channel by revenue, along with that channel's revenue, the total revenue for the group-year, and the channel's share of the group-year revenue. Return columns: Group, Fiscal Year, top_channel, channel_revenue, group_year_revenue, channel_revenue_share_pct. Sort by Group, then Fiscal Year ascending.",
    "difficulty": "hard",
    "sql": "WITH channel_year AS (SELECT t.\"Group\", d.\"Fiscal Year\", so.Channel, ROUND(SUM(s.\"Sales Amount\"), 2) AS channel_revenue FROM Sales s JOIN Sales_Territory t ON s.SalesTerritoryKey = t.SalesTerritoryKey JOIN Date d ON s.OrderDateKey = d.DateKey JOIN Sales_Order so ON s.SalesOrderLineKey = so.SalesOrderLineKey GROUP BY t.\"Group\", d.\"Fiscal Year\", so.Channel), ranked AS (SELECT \"Group\", \"Fiscal Year\", Channel, channel_revenue, ROUND(SUM(channel_revenue) OVER (PARTITION BY \"Group\", \"Fiscal Year\"), 2) AS group_year_revenue, ROUND(channel_revenue * 100.0 / SUM(channel_revenue) OVER (PARTITION BY \"Group\", \"Fiscal Year\"), 1) AS channel_revenue_share_pct, ROW_NUMBER() OVER (PARTITION BY \"Group\", \"Fiscal Year\" ORDER BY channel_revenue DESC, Channel ASC) AS channel_rank FROM channel_year) SELECT \"Group\", \"Fiscal Year\", Channel AS top_channel, channel_revenue, group_year_revenue, channel_revenue_share_pct FROM ranked WHERE channel_rank = 1 ORDER BY \"Group\", \"Fiscal Year\"",
    "included_tables": [
      "Sales",
      "Sales_Territory",
      "Date",
      "Sales_Order"
    ],
    "row_count": 9,
    "columns": [
      "Group",
      "Fiscal Year",
      "top_channel",
      "channel_revenue",
      "group_year_revenue",
      "channel_revenue_share_pct"
    ],
    "first_row": {
      "Group": "Europe",
      "Fiscal Year": "FY2018",
      "top_channel": "Internet",
      "channel_revenue": 1602430.23,
      "group_year_revenue": 1602430.23,
      "channel_revenue_share_pct": 100
    }
  }
] as const;
