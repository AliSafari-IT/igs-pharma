using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace IGS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class MigrationName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 30, 6, 14, 14, 653, DateTimeKind.Utc).AddTicks(5178), new DateTime(2025, 6, 30, 6, 14, 14, 653, DateTimeKind.Utc).AddTicks(5181) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 2,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 30, 6, 14, 14, 653, DateTimeKind.Utc).AddTicks(5213), new DateTime(2025, 6, 30, 6, 14, 14, 653, DateTimeKind.Utc).AddTicks(5214) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 3,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 30, 6, 14, 14, 653, DateTimeKind.Utc).AddTicks(5216), new DateTime(2025, 6, 30, 6, 14, 14, 653, DateTimeKind.Utc).AddTicks(5216) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 4,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 30, 6, 14, 14, 653, DateTimeKind.Utc).AddTicks(5217), new DateTime(2025, 6, 30, 6, 14, 14, 653, DateTimeKind.Utc).AddTicks(5217) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 5,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 30, 6, 14, 14, 653, DateTimeKind.Utc).AddTicks(5219), new DateTime(2025, 6, 30, 6, 14, 14, 653, DateTimeKind.Utc).AddTicks(5219) });

            migrationBuilder.UpdateData(
                table: "Users",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "CreatedAt", "LastLoginAt", "PasswordHash", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 30, 6, 14, 14, 842, DateTimeKind.Utc).AddTicks(8999), new DateTime(2025, 6, 30, 6, 14, 14, 842, DateTimeKind.Utc).AddTicks(9005), "$2a$11$9oMCIR.C/4Cg1iRfPGjIR.vuVdnYJPM0/nPXWVvhVCRczcRlKZxS2", new DateTime(2025, 6, 30, 6, 14, 14, 842, DateTimeKind.Utc).AddTicks(9004) });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 28, 18, 952, DateTimeKind.Utc).AddTicks(389), new DateTime(2025, 6, 29, 20, 28, 18, 952, DateTimeKind.Utc).AddTicks(393) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 2,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 28, 18, 952, DateTimeKind.Utc).AddTicks(397), new DateTime(2025, 6, 29, 20, 28, 18, 952, DateTimeKind.Utc).AddTicks(397) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 3,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 28, 18, 952, DateTimeKind.Utc).AddTicks(399), new DateTime(2025, 6, 29, 20, 28, 18, 952, DateTimeKind.Utc).AddTicks(399) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 4,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 28, 18, 952, DateTimeKind.Utc).AddTicks(400), new DateTime(2025, 6, 29, 20, 28, 18, 952, DateTimeKind.Utc).AddTicks(401) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 5,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 28, 18, 952, DateTimeKind.Utc).AddTicks(402), new DateTime(2025, 6, 29, 20, 28, 18, 952, DateTimeKind.Utc).AddTicks(402) });

            migrationBuilder.UpdateData(
                table: "Users",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "CreatedAt", "LastLoginAt", "PasswordHash", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 28, 19, 163, DateTimeKind.Utc).AddTicks(4371), new DateTime(2025, 6, 29, 20, 28, 19, 163, DateTimeKind.Utc).AddTicks(4377), "$2a$11$Vt.MUX.MZ7W.9BLKJBpZXOiygJIBpGTEnpCmoUPErBqt9rrgAdnyq", new DateTime(2025, 6, 29, 20, 28, 19, 163, DateTimeKind.Utc).AddTicks(4376) });
        }
    }
}
