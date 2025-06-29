# Backend Authentication Integration Guide

## ID Card Reader Authentication Endpoints

### 1. Traditional Login Endpoint
```csharp
[HttpPost("login")]
public async Task<IActionResult> Login([FromBody] LoginRequest request)
{
    var user = await _userService.ValidateCredentialsAsync(request.Username, request.Password);
    if (user == null)
        return Unauthorized(new { message = "Invalid credentials" });

    var token = _jwtService.GenerateToken(user);
    return Ok(new LoginResponse 
    { 
        Token = token, 
        User = user 
    });
}
```

### 2. ID Card Authentication Endpoint
```csharp
[HttpPost("card-login")]
public async Task<IActionResult> CardLogin([FromBody] CardLoginRequest request)
{
    try
    {
        // Parse and validate card data
        var cardInfo = ParseCardData(request.CardData);
        
        // Lookup user by card ID or employee ID
        var user = await _userService.GetUserByCardIdAsync(cardInfo.CardId) 
                ?? await _userService.GetUserByEmployeeIdAsync(cardInfo.EmployeeId);
        
        if (user == null)
            return Unauthorized(new { message = "Card not recognized" });
        
        // Additional security checks
        if (!user.IsActive || user.CardExpired)
            return Unauthorized(new { message = "Card access denied" });
        
        // Log card access
        await _auditService.LogCardAccessAsync(user.Id, cardInfo);
        
        var token = _jwtService.GenerateToken(user);
        return Ok(new LoginResponse 
        { 
            Token = token, 
            User = user 
        });
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Card authentication failed");
        return BadRequest(new { message = "Card authentication failed" });
    }
}
```

### 3. Token Verification Endpoint
```csharp
[HttpGet("verify")]
[Authorize]
public async Task<IActionResult> VerifyToken()
{
    var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
    var user = await _userService.GetUserByIdAsync(userId);
    
    if (user == null || !user.IsActive)
        return Unauthorized();
    
    return Ok(new { valid = true, user });
}
```

## Data Models

### Card Data Structure
```csharp
public class CardData
{
    public string CardId { get; set; }
    public string EmployeeId { get; set; }
    public string Name { get; set; }
    public string Department { get; set; }
    public DateTime? ExpiryDate { get; set; }
    public string AccessLevel { get; set; }
}

public class CardLoginRequest
{
    public CardData CardData { get; set; }
}
```

### User Model with Card Support
```csharp
public class User
{
    public string Id { get; set; }
    public string Username { get; set; }
    public string Email { get; set; }
    public string FirstName { get; set; }
    public string LastName { get; set; }
    public string Role { get; set; }
    public string Department { get; set; }
    public List<string> Permissions { get; set; }
    public bool IsActive { get; set; }
    
    // Card-specific properties
    public string CardId { get; set; }
    public string EmployeeId { get; set; }
    public DateTime? CardExpiryDate { get; set; }
    public bool CardExpired => CardExpiryDate.HasValue && CardExpiryDate < DateTime.UtcNow;
}
```

## Recommended ID Card Reader Hardware

### USB Smart Card Readers
1. **ACS ACR122U** - NFC/RFID reader (~$40)
   - Supports ISO 14443 Type A & B cards
   - USB interface
   - Good driver support

2. **Gemalto PC Twin Reader** - Dual slot reader (~$60)
   - Supports contact and contactless cards
   - EMV certified
   - Enterprise grade

3. **HID OMNIKEY 5x27** - Professional grade (~$80)
   - Multiple card support
   - Excellent security features
   - Wide compatibility

### Integration Libraries
- **PC/SC (Personal Computer/Smart Card)** - Standard Windows API
- **Web Serial API** - For direct browser access
- **WebUSB API** - For USB device communication
- **smartcard-reader npm package** - JavaScript wrapper

## Security Considerations

1. **Card Data Encryption**: Always encrypt card data in transit
2. **Access Logging**: Log all card access attempts
3. **Card Expiry**: Implement card expiration checks
4. **Rate Limiting**: Prevent brute force attacks
5. **Audit Trail**: Maintain detailed access logs
6. **Backup Authentication**: Always provide username/password fallback

## Implementation Steps

1. **Hardware Setup**: Install card reader drivers
2. **Backend API**: Implement card authentication endpoints
3. **Frontend Integration**: Add card reading functionality
4. **Database Schema**: Add card-related user fields
5. **Security Testing**: Test all authentication flows
6. **User Training**: Train staff on card usage

## Testing Card Readers

You can test card reader functionality with:
- Employee ID cards with magnetic strips
- Smart cards with embedded chips
- NFC-enabled cards or phones
- Custom printed cards with barcodes/QR codes
