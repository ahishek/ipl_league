from __future__ import annotations

import urllib.parse
from pathlib import Path

import pandas as pd


SHEET_URL = "https://docs.google.com/spreadsheets/d/1n4wZ_KymT8Njo4wBojJM_B0XO7K5H6j_XIaNxVcypT8/edit?usp=sharing"
SHEET_TAB = "Copy of All Players Data"


def main() -> None:
    outdir = Path("output/spreadsheet")
    outdir.mkdir(parents=True, exist_ok=True)

    sheet_id = SHEET_URL.split("/d/")[1].split("/")[0]
    csv_url = (
        f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv"
        f"&sheet={urllib.parse.quote(SHEET_TAB)}"
    )

    df = pd.read_csv(csv_url)
    numeric_columns = [
        "Base Price",
        "Matches",
        "Runs",
        "Bat Avg",
        "IPL Auction Price",
        "BAT SR",
        "Wickets",
        "BOWL SR",
        "Economy Rate",
        "Bowl Avg",
    ]
    for column in numeric_columns:
      df[column] = pd.to_numeric(df[column], errors="coerce").fillna(0)

    role_summary = (
        df.groupby("Role")
        .agg(
            players=("Name", "count"),
            avg_base_price=("Base Price", "mean"),
            avg_runs=("Runs", "mean"),
            avg_wickets=("Wickets", "mean"),
        )
        .reset_index()
    )

    pool_summary = (
        df.groupby("Pool")
        .agg(
            players=("Name", "count"),
            median_base_price=("Base Price", "median"),
            avg_auction_price=("IPL Auction Price", "mean"),
        )
        .reset_index()
    )

    highest_base = df.sort_values("Base Price", ascending=False).head(25)
    highest_runs = df.sort_values("Runs", ascending=False).head(25)
    highest_wickets = df.sort_values("Wickets", ascending=False).head(25)

    overview = pd.DataFrame(
        [
            {"Metric": "Source URL", "Value": SHEET_URL},
            {"Metric": "Sheet Tab", "Value": SHEET_TAB},
            {"Metric": "Players", "Value": len(df)},
            {"Metric": "Roles", "Value": df["Role"].nunique()},
            {"Metric": "Pools", "Value": df["Pool"].nunique()},
            {"Metric": "Average Base Price", "Value": round(df["Base Price"].mean(), 2)},
            {"Metric": "Average Auction Price", "Value": round(df["IPL Auction Price"].mean(), 2)},
            {"Metric": "Players with Image URL", "Value": int(df["Image URL"].astype(str).str.len().gt(0).sum())},
        ]
    )

    output_path = outdir / "sample-player-sheet-analysis.xlsx"
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        overview.to_excel(writer, sheet_name="Overview", index=False)
        role_summary.to_excel(writer, sheet_name="Role Summary", index=False)
        pool_summary.to_excel(writer, sheet_name="Pool Summary", index=False)
        highest_base.to_excel(writer, sheet_name="Top Base Prices", index=False)
        highest_runs.to_excel(writer, sheet_name="Top Run Scorers", index=False)
        highest_wickets.to_excel(writer, sheet_name="Top Wicket Takers", index=False)
        df.to_excel(writer, sheet_name="Raw Sample Data", index=False)

        workbook = writer.book
        for sheet_name in workbook.sheetnames:
            sheet = workbook[sheet_name]
            sheet.freeze_panes = "A2"
            for column_cells in sheet.columns:
                width = max(len(str(cell.value or "")) for cell in column_cells[:50]) + 2
                sheet.column_dimensions[column_cells[0].column_letter].width = min(width, 32)

    print(output_path)


if __name__ == "__main__":
    main()
