using System;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace IGS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSettingsEntity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DoctorId",
                table: "Patients",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Doctors",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySql:ValueGenerationStrategy", MySqlValueGenerationStrategy.IdentityColumn),
                    FirstName = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    LastName = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Email = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Phone = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Specialization = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    LicenseNumber = table.Column<string>(type: "varchar(50)", maxLength: 50, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    IsActive = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Doctors", x => x.Id);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Settings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySql:ValueGenerationStrategy", MySqlValueGenerationStrategy.IdentityColumn),
                    PharmacyName = table.Column<string>(type: "longtext", nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Address = table.Column<string>(type: "longtext", nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Phone = table.Column<string>(type: "longtext", nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Email = table.Column<string>(type: "longtext", nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    LowStockAlerts = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    ExpiryAlerts = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    PrescriptionReminders = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    EmailNotifications = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    SmsNotifications = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    AutoReorder = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    ReorderThreshold = table.Column<int>(type: "int", nullable: false),
                    DefaultSupplier = table.Column<string>(type: "longtext", nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    SessionTimeout = table.Column<int>(type: "int", nullable: false),
                    RequirePasswordChange = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    TwoFactorAuth = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    AutoBackup = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    BackupFrequency = table.Column<string>(type: "longtext", nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    RetentionDays = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Settings", x => x.Id);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 7, 1, 12, 46, 21, 382, DateTimeKind.Utc).AddTicks(4393), new DateTime(2025, 7, 1, 12, 46, 21, 382, DateTimeKind.Utc).AddTicks(4396) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 2,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 7, 1, 12, 46, 21, 382, DateTimeKind.Utc).AddTicks(4443), new DateTime(2025, 7, 1, 12, 46, 21, 382, DateTimeKind.Utc).AddTicks(4444) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 3,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 7, 1, 12, 46, 21, 382, DateTimeKind.Utc).AddTicks(4446), new DateTime(2025, 7, 1, 12, 46, 21, 382, DateTimeKind.Utc).AddTicks(4447) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 4,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 7, 1, 12, 46, 21, 382, DateTimeKind.Utc).AddTicks(4587), new DateTime(2025, 7, 1, 12, 46, 21, 382, DateTimeKind.Utc).AddTicks(4588) });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: 5,
                columns: new[] { "CreatedAt", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 7, 1, 12, 46, 21, 382, DateTimeKind.Utc).AddTicks(4590), new DateTime(2025, 7, 1, 12, 46, 21, 382, DateTimeKind.Utc).AddTicks(4590) });

            migrationBuilder.UpdateData(
                table: "Users",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "CreatedAt", "LastLoginAt", "PasswordHash", "UpdatedAt" },
                values: new object[] { new DateTime(2025, 7, 1, 12, 46, 21, 661, DateTimeKind.Utc).AddTicks(5739), new DateTime(2025, 7, 1, 12, 46, 21, 661, DateTimeKind.Utc).AddTicks(5746), "$2a$11$MioJRjADnCTgNdXODNsYx.DIPV2x5t2iWKVncMc8CaR26X1UpbJna", new DateTime(2025, 7, 1, 12, 46, 21, 661, DateTimeKind.Utc).AddTicks(5745) });

            migrationBuilder.CreateIndex(
                name: "IX_Patients_DoctorId",
                table: "Patients",
                column: "DoctorId");

            migrationBuilder.CreateIndex(
                name: "IX_Doctors_Email",
                table: "Doctors",
                column: "Email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Doctors_LicenseNumber",
                table: "Doctors",
                column: "LicenseNumber",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Doctors_Phone",
                table: "Doctors",
                column: "Phone");

            migrationBuilder.AddForeignKey(
                name: "FK_Patients_Doctors_DoctorId",
                table: "Patients",
                column: "DoctorId",
                principalTable: "Doctors",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Patients_Doctors_DoctorId",
                table: "Patients");

            migrationBuilder.DropTable(
                name: "Doctors");

            migrationBuilder.DropTable(
                name: "Settings");

            migrationBuilder.DropIndex(
                name: "IX_Patients_DoctorId",
                table: "Patients");

            migrationBuilder.DropColumn(
                name: "DoctorId",
                table: "Patients");

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
    }
}
