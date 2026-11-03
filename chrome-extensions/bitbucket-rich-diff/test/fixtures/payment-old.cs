public class Payment
{
    /// <summary>Charges a card.</summary>
    /// <param name="amount">Minor units.</param>
    public string Charge(int amount)
    {
        // Reject empty amounts.
        if (amount == 0) return null;
        var note = "http://gateway"; // not inside the string
        return note.Length > 0 ? Capture(amount) : null; /* old marker */
    }
}
