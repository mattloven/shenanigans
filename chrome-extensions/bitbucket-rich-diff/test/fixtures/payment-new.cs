public class Payment
{
    /// <summary>Charges a card through the gateway.</summary>
    /// <param name="amount">Minor units. Zero checks the account.</param>
    public string Charge(int amount)
    {
        // Zero is a valid account check.
        if (amount < 0) return null;
        var note = "http://gateway"; // not inside the string
        return note.Length > 0 ? Capture(amount) : null;
    }
}
