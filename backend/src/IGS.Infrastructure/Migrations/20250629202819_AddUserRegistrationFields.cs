using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace IGS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddUserRegistrationFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CardExpiryDate",
                table: "Users",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CardId",
                table: "Users",
                type: "varchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "")
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<string>(
                name: "Department",
                table: "Users",
                type: "varchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "")
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<string>(
                name: "EmployeeId",
                table: "Users",
                type: "varchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "")
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<string>(
                name: "Permissions",
                table: "Users",
                type: "longtext",
                nullable: false)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<string>(
                name: "Username",
                table: "Users",
                type: "varchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "")
                .Annotation("MySql:CharSet", "utf8mb4");

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
                columns: new[] { "CardExpiryDate", "CardId", "CreatedAt", "Department", "EmployeeId", "LastLoginAt", "PasswordHash", "Permissions", "UpdatedAt", "Username" },
                values: new object[] { null, "", new DateTime(2025, 6, 29, 20, 28, 19, 163, DateTimeKind.Utc).AddTicks(4371), "", "", new DateTime(2025, 6, 29, 20, 28, 19, 163, DateTimeKind.Utc).AddTicks(4377), "$2a$11$Vt.MUX.MZ7W.9BLKJBpZXOiygJIBpGTEnpCmoUPErBqt9rrgAdnyq", "[]", new DateTime(2025, 6, 29, 20, 28, 19, 163, DateTimeKind.Utc).AddTicks(4376), "" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CardExpiryDate",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CardId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Department",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "EmployeeId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Permissions",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Username",
                table: "Users");

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 1, 55, 116, DateTimeKind.Utc).AddTicks(4338), new DateTime(2025, 6, 29, 20, 1, 55, 116, DateTimeKind.Utc).AddTicks(4342) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 2,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 1, 55, 116, DateTimeKind.Utc).AddTicks(4387), new DateTime(2025, 6, 29, 20, 1, 55, 116, DateTimeKind.Utc).AddTicks(4388) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 3,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 1, 55, 116, DateTimeKind.Utc).AddTicks(4389), new DateTime(2025, 6, 29, 20, 1, 55, 116, DateTimeKind.Utc).AddTicks(4389) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 4,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 1, 55, 116, DateTimeKind.Utc).AddTicks(4391), new DateTime(2025, 6, 29, 20, 1, 55, 116, DateTimeKind.Utc).AddTicks(4391) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 5,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 1, 55, 116, DateTimeKind.Utc).AddTicks(4393), new DateTime(2025, 6, 29, 20, 1, 55, 116, DateTimeKind.Utc).AddTicks(4394) });

            migrationBuilder.UpdateData(
                table: "Users",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "CreatedAt", "LastLoginAt", "PasswordHash", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 6, 29, 20, 1, 55, 588, DateTimeKind.Utc).AddTicks(4831), new DateTime(2025, 6, 29, 20, 1, 55, 588, DateTimeKind.Utc).AddTicks(4840), "$2a$11$ciWbz.EksHnzGPkW/gzGtOkJVXSutZbKL3igCpcZOqHDbXVTu8eZO", new DateTime(2025, 6, 29, 20, 1, 55, 588, DateTimeKind.Utc).AddTicks(4838) });
        }
    }
}
