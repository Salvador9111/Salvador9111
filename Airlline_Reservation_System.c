#include <stdio.h> // Standard I/O library for terminal input/output
#include <stdlib.h> // Standard library for utility functions like rand/exit
#include <string.h> // String library for manipulation and comparison
#include <time.h>  // Time library for seeding the random number generator


// =================== STRUCTURES ===================
struct User // Define structure to store user account details
{
    int userId;            // Unique numeric identifier for the user
    char name[50];         // Full name of the user
    char email[50];        // User email address for login
    char password[50];     // User password for authentication
    char recoveryCode[5];  // 4-digit numeric code for password recovery
    float cash_balance;    // Current electronic wallet balance of the user
};

struct Flight // Define structure to store flight information
{
    int flight_id;         // Unique identifier for each flight
    char airline[50];      // Name of the airline company
    char from[50];         // Departure city
    char to[50];           // Destination city
    char date[15];         // Date of travel (DD-MM-YYYY)
    char time[10];         // Time of departure (HH:MM)
    char typeFlight[30];   // Type of flight (e.g., Domestic, International)
    int total_seats;       // Maximum capacity of the aircraft
    int remaining_seats;   // Current number of unsold seats
    float price;           // Cost of a single ticket
};

struct seat // Define structure to track individual seat status
{
    int flight_id;         // ID of the flight this seat belongs to
    int seat_no;           // Number of the specific seat
    int seat_booked;       // Boolean flag: 0 for available, 1 for booked
};

struct Booking // Define structure to record ticket purchases
{
    int bookingId;         // Unique identifier for the booking transaction
    int userId;            // ID of the user who made the purchase
    int flight_id;         // ID of the flight booked
    int seat_no;           // The specific seat number assigned
    int status;            // Booking status: 1 for Active, 0 for Cancelled
    char paymentMethod[10]; // String indicating "Cash" or "Card"
};

// ======================= PROTOTYPES =========================

// =========== Admin
void adminLogin();                    // Function to handle administrator authentication
void adminMenu();                     // Function to display and handle admin options
void addFlight();                     // Function to create and save a new flight record
void seat_in_flight(struct Flight f); // Function to initialize seats for a new flight
void deleteFlight();                  // Function to remove a flight and its seats
void deleteSeats(int flightId);       // Helper function to remove seats from the database
void editFlight();                    // Function to modify existing flight details
void viewUserDetails();               // Function to display all registered users
int  flightExists(int id);            // Helper to check if a flight ID is taken
void view_all_Flights_sorted(int byPrice); // Function to display flights with sorting


// =========== User
void RegisterUser();                  // Function to handle new user account creation
int  LoginUser();                     // Function to authenticate user login credentials
void userMenu(int loggedInUserId);    // Function to display and handle user options
void bookFlight(int loggedInUserId);  // Function to process a flight booking
void view_my_flight(int loggedInUserId); // Function to show bookings for a specific user
void del_booking(int loggedInUserId); // Function to handle booking cancellations
int  countAvailableSeats(int flightId); // Helper to count unbooked seats for a flight
void forgotPassword(void);            // Function to reset user password via recovery code
void generateRecoveryCode(char *code); // Helper to create a random 4-digit code


// Payment
int  chooseSeat(int flightId);
int  payForFlight(int userId, float price, char *method);

// Booking ID
int generateBookingId();



// ================= MAIN FUNCTION =================
int main()
{
    srand((unsigned) time(NULL));
    int choice;
    int loggedInId = 0;
    do 
    {
        printf("\n==== AIRLINE RESERVATION SYSTEM ====\n");
        printf("1. Admin Login \n");
        printf("2. User Registration \n");
        printf("3. User Login \n");
        printf("4. Forgot password \n");
        printf("5. Exit \n");

        printf("Enter choice: ");
        scanf("%d", &choice);
        getchar(); 

        switch(choice)
        {
            case 1:
                adminLogin();
                break;
            case 2:
                RegisterUser();
                break;
            case 3:
                loggedInId = LoginUser();
                if(loggedInId > 0)
                    userMenu(loggedInId);
                break;
            case 4:
                forgotPassword();
                break;
            case 5:
                printf("Exiting system. Goodbye!\n");
                break;
            default:
                printf("Invalid choice!\n");
        }

    } while(choice != 5);
    return 0;
}


// ================= HELPER FUNCTIONS =================
void generateRecoveryCode(char *code) // Generate a random 4-digit string
{
    for (int i = 0; i < 4; i++) // Iterate 4 times for 4 digits
    {
        code[i] = '0' + rand() % 10; // Assign a random char from '0'-'9'
    }
    code[4] = '\0'; // Null-terminate the string
}
    

// ================= ADMIN FUNCTIONS =================
void adminLogin()
{
    char id[50], pass[50];
    printf("\n--- ADMIN LOGIN ---\n");
    printf("Enter admin id: ");
    scanf("%s", id);
    printf("Enter admin password: ");
    scanf("%s", pass);

    if(strcmp(id,"admin")==0 && strcmp(pass,"admin123")==0)
    {
        printf("==== Admin Login successful! ====\n");
        adminMenu();
    }
    else
    {
        printf("Wrong id or password!\n");
    }
}

// ================= ADMIN MENU =================
void adminMenu() // Display administrative options
{
    int choice; // Local menu selection variable
    while(1) // Infinite loop until logout
    {
        printf("\n--- ADMIN MENU ---\n");
        printf("1. Add Flight \n");
        printf("2. View Flights \n");
        printf("3. Delete Flight \n");
        printf("4. Edit Flight \n");
        printf("5. View Users Details\n");
        printf("6. Logout \n");
    
        printf("Enter choice: ");
        scanf("%d", &choice); // Read admin choice
        getchar(); // Consume newline

        switch(choice) // Handle admin choices
        {
            case 1: 
                addFlight(); // Call add flight logic
                break;
            case 2: 
            {
                int sChoice; // Variable for sort preference
                printf("Sort by: \n");
                printf(" 1. Price \n"); 
                printf(" 2. Date \n"); 
                printf(" 3. No Sort: \n"); 

                printf("Choose: ");
                scanf("%d",&sChoice); // Read sort choice
                view_all_Flights_sorted(sChoice==1); // Display sorted/unsorted flights
                break;
            }
            case 3: 
                deleteFlight(); // Call delete flight logic
                break;
            case 4: 
                editFlight(); // Call modify flight logic
                break;
            case 5: 
                viewUserDetails(); // Show all user accounts
                break;
            case 6: 
                return; // Exit menu function (Logout)
            default:
                printf("Invalid choice!\n");
        }
    }
}


// ================= FLIGHT FUNCTIONS =================
int flightExists(int id) // Check if a flight ID is already in the file
{
    FILE *fp = fopen("flights.dat","rb"); // Open flights database for reading
    if(!fp) return 0; // Return false if file doesn't exist
    struct Flight f; // Temporary flight storage
    while(fread(&f,sizeof(struct Flight),1,fp)) // Read file record by record
    {
        if(f.flight_id==id) // If ID matches
        { 
            fclose(fp); // Close file
            return 1; // Return true
        }
    }
    fclose(fp); // Close file
    return 0; // Return false if no match found
}

void addFlight() // Create a new flight record
{
    FILE *fp = fopen("flights.dat","ab"); // Open in append binary mode
    if(!fp)
    { 
        printf("File error.\n"); 
        return; 
    }

    struct Flight f; // Flight object to populate
    printf("Flight ID: "); 
    scanf("%d",&f.flight_id); // Get ID
    getchar(); // Consume newline
    if(flightExists(f.flight_id)) // Validate ID uniqueness
    { 
        printf("Flight ID exists.\n"); 
        fclose(fp); 
        return; 
    }

    printf("Airline: "); 
    fgets(f.airline,50,stdin); // Read airline name
    f.airline[strcspn(f.airline,"\n")]=0; // Strip newline
    
    printf("From: "); 
    fgets(f.from,50,stdin); // Read origin
    f.from[strcspn(f.from,"\n")]=0; // Strip newline
    
    printf("To: "); 
    fgets(f.to,50,stdin); // Read destination
    f.to[strcspn(f.to,"\n")]=0; // Strip newline
    
    printf("Date (DD-MM-YYYY): "); 
    fgets(f.date,15,stdin); // Read date
    f.date[strcspn(f.date,"\n")]=0; // Strip newline
    
    printf("Time (HH:MM): "); 
    fgets(f.time,10,stdin); // Read time
    f.time[strcspn(f.time,"\n")]=0; // Strip newline
    
    printf("Type: "); 
    fgets(f.typeFlight,30,stdin); // Read flight type
    f.typeFlight[strcspn(f.typeFlight,"\n")]=0; // Strip newline
    
    printf("Total Seats: "); 
    scanf("%d",&f.total_seats); // Read capacity
    
    printf("Price: "); 
    scanf("%f",&f.price); // Read ticket price
    f.remaining_seats=f.total_seats; // Initially, all seats are remaining

    fwrite(&f,sizeof(struct Flight),1,fp); // Write record to file
    fclose(fp); // Close file

    seat_in_flight(f); // Initialize the individual seat records for this flight
    printf("===== Flight added successfully! ======\n");
}


// ================= DELETE FLIGHT =================
void deleteFlight() // Remove a specific flight from the database
{
    int id, found = 0;
    printf("Enter Flight ID to delete: ");
    scanf("%d", &id); // Input target ID
    getchar(); // Consume newline

    // First, read the flight to get details like price
    FILE *fpFlight = fopen("flights.dat", "rb");
    struct Flight f;
    float flightPrice = 0.0;
    int flightFound = 0;
    if (fpFlight) {
        while (fread(&f, sizeof(struct Flight), 1, fpFlight)) {
            if (f.flight_id == id) {
                flightPrice = f.price;
                flightFound = 1;
                break;
            }
        }
        fclose(fpFlight);
    }
    if (!flightFound) {
        printf("Flight ID not found.\n");
        return;
    }

    // Now, handle bookings: cancel them, release seats, and refund if Cash
    FILE *fpBooking = fopen("bookings.dat", "rb");
    FILE *tempBooking = fopen("temp_bookings.dat", "wb");
    if (!fpBooking || !tempBooking) {
        printf("Error accessing booking records.\n");
        if (fpBooking) fclose(fpBooking);
        if (tempBooking) fclose(tempBooking);
        return;
    }

    struct Booking b;
    while (fread(&b, sizeof(struct Booking), 1, fpBooking)) {
        if (b.flight_id == id && b.status == 1) { // Active booking for this flight
            // Cancel the booking
            b.status = 0;

            // Release the seat
            FILE *fpSeat = fopen("seats.dat", "rb+");
            if (fpSeat) {
                struct seat s;
                while (fread(&s, sizeof(struct seat), 1, fpSeat)) {
                    if (s.flight_id == id && s.seat_no == b.seat_no) {
                        s.seat_booked = 0; // Release seat
                        fseek(fpSeat, -sizeof(struct seat), SEEK_CUR);
                        fwrite(&s, sizeof(struct seat), 1, fpSeat);
                        break;
                    }
                }
                fclose(fpSeat);
            }

            // Refund if Cash payment
            if (strcmp(b.paymentMethod, "Cash") == 0) {
                FILE *fpUser = fopen("users.dat", "rb+");
                if (fpUser) {
                    struct User u;
                    while (fread(&u, sizeof(struct User), 1, fpUser)) {
                        if (u.userId == b.userId) {
                            u.cash_balance += flightPrice; // Refund
                            fseek(fpUser, -sizeof(struct User), SEEK_CUR);
                            fwrite(&u, sizeof(struct User), 1, fpUser);
                            break;
                        }
                    }
                    fclose(fpUser);
                }
            }
        }
        // Write the (possibly updated) booking to temp
        fwrite(&b, sizeof(struct Booking), 1, tempBooking);
    }
    fclose(fpBooking);
    fclose(tempBooking);

    // Replace bookings file
    remove("bookings.dat");
    rename("temp_bookings.dat", "bookings.dat");

    // Now proceed with deleting the flight record
    FILE *fp = fopen("flights.dat", "rb"); // Open source file
    FILE *temp = fopen("temp_flights.dat", "wb"); // Open temporary file
    
    if (!fp || !temp) // Handle file opening errors
    {
        printf("Error accessing flight records.\n");
        if (fp) fclose(fp);
        if (temp) fclose(temp);
        return;
    }

    while (fread(&f, sizeof(struct Flight), 1, fp)) // Process each flight record
    {
        if (f.flight_id == id) // Check for match
        {
            found = 1; // Mark as found to trigger cleanup later
        }
        else
        {
            fwrite(&f, sizeof(struct Flight), 1, temp); // Keep non-matching records
        }
    }

    fclose(fp);
    fclose(temp);

    if (found) // If flight was successfully located
    {
        remove("flights.dat"); // Delete original file
        rename("temp_flights.dat", "flights.dat"); // Replace with updated file
        deleteSeats(id); // Remove corresponding seat entries
        printf("Flight deleted successfully!\nBooking cancelled and refunded.\n");
    }
    else // If flight ID was not in the system (shouldn't happen since we checked earlier)
    {
        remove("temp_flights.dat"); // Clean up temporary file
        printf("Flight ID not found.\n");
    }
}

// ================= SEAT FUNCTIONS =================
void seat_in_flight(struct Flight f) // Initialize individual seat records for a new flight
{
    FILE *fp = fopen("seats.dat","ab"); // Open seats file in append mode
    if(!fp)
    { 
        printf("Seats file error.\n"); 
        return; 
    }
    struct seat s;
    for(int i=1;i<=f.total_seats;i++) // Create a seat record for each seat
    {
        s.flight_id=f.flight_id;
        s.seat_no=i;
        s.seat_booked=0; // Initially unbooked
        fwrite(&s,sizeof(struct seat),1,fp); // Save seat record
    }
    fclose(fp);
}

void deleteSeats(int flightId) // Helper function to delete seats for a specific flight
{
    FILE *fp=fopen("seats.dat","rb"); // Open current seats file
    FILE *temp=fopen("temp_seats.dat","wb"); // Open temporary seats file
    if (!fp || !temp)
    {
        if (fp) 
            fclose(fp);
        if (temp) 
            fclose(temp);
        printf("Seat file error.\n"); // Handle file errors
        return;
    }
    struct seat s;
    while(fread(&s,sizeof(struct seat),1,fp)) // Iterate through all seats
    {
        if(s.flight_id != flightId) // Only keep seats NOT belonging to the deleted flight
        {
            fwrite(&s,sizeof(struct seat),1,temp);
        }
    }
    fclose(fp); 
    fclose(temp);
    remove("seats.dat"); // Remove old file
    rename("temp_seats.dat","seats.dat"); // Rename temp file to main file
}


void editFlight()
{
    FILE *fp=fopen("flights.dat","rb");
    if(!fp)
    { 
        printf("No flights available.\n"); 
        return; 
    }
    FILE *temp=fopen("temp_flights.dat","wb");
    if(!temp)
    { 
        printf("Temp file error.\n"); 
        fclose(fp); 
        return; 
    }

    struct Flight f;
    int fid, found=0;
    printf("Flight ID to edit: "); 
    scanf("%d",&fid); 
    getchar();
    while(fread(&f,sizeof(struct Flight),1,fp))
    {
        if(f.flight_id==fid) 
        {
            found=1;
            printf("Airline: "); 
            fgets(f.airline,50,stdin); 
            f.airline[strcspn(f.airline,"\n")]=0;
            
            printf("From: "); 
            fgets(f.from,50,stdin); 
            f.from[strcspn(f.from,"\n")]=0;
            
            printf("To: "); 
            fgets(f.to,50,stdin); 
            f.to[strcspn(f.to,"\n")]=0;
            
            printf("Date: "); 
            fgets(f.date,15,stdin); 
            f.date[strcspn(f.date,"\n")]=0;
            
            printf("Time: "); 
            fgets(f.time,10,stdin); 
            f.time[strcspn(f.time,"\n")]=0;
            
            printf("Type: "); 
            fgets(f.typeFlight,30,stdin); 
            f.typeFlight[strcspn(f.typeFlight,"\n")]=0;
            
            printf("Price: "); 
            scanf("%f",&f.price); 
            getchar();
            printf("===== Flight edited successfully! =====");
        }
        fwrite(&f,sizeof(struct Flight),1,temp); // Keep non-matching records
    }
    fclose(fp); 
    fclose(temp);
    if(!found)
    { 
        printf("Flight not found.\n"); 
        remove("temp_flights.dat"); 
        return; 
    }
    remove("flights.dat"); 
    rename("temp_flights.dat","flights.dat"); // Rename temp file to main file
}


void viewUserDetails()
{
    FILE *fp=fopen("users.dat","rb");
    if(!fp)
    { 
        printf("No users.\n"); 
        return; 
    }

    struct User u;
    printf("\n=== USERS ===\n");
    while(fread(&u,sizeof(struct User),1,fp))
    {
        printf("ID:%d\nName:%s\nEmail:%s\nBalance:%.2f\n",u.userId,u.name,u.email,u.cash_balance);
    }
    fclose(fp);
}


void view_all_Flights_sorted(int byPrice)
{
    FILE *fp=fopen("flights.dat","rb");
    if(!fp)
    { 
        printf("No flights.\n"); 
        return; 
    }

    struct Flight flights[100]; int n=0; 
    struct Flight f;
    while(fread(&f,sizeof(struct Flight),1,fp)) 
    flights[n++] = f; // Load flights into array
    fclose(fp);
    for (int i = 0; i < n - 1; i++) // Simple Bubble Sort
    {
        for (int j = 0; j < n - i - 1; j++) 
        {
            int swap = 0;
            if (byPrice && flights[j].price > flights[j + 1].price) {
                swap = 1;
            }
            else if (!byPrice && strcmp(flights[j].date, flights[j + 1].date) > 0) {
                swap = 1;
            }
            if (swap) {
                struct Flight t = flights[j];
                flights[j] = flights[j + 1];
                flights[j + 1] = t;
            }
        }
    }
    printf("\n%-5s %-10s %-10s %-10s %-12s %-8s %-6s %-8s\n","ID","Airline","From","To","Date","Time","Seats","Price");
    for(int i=0;i<n;i++)
    {
        printf("%-5d %-10s %-10s %-10s %-12s %-8s %-6d %-8.2f\n",
            flights[i].flight_id,flights[i].airline,flights[i].from,flights[i].to,flights[i].date,
            flights[i].time,countAvailableSeats(flights[i].flight_id),flights[i].price);
    }
}


int countAvailableSeats(int flightId)
{
    FILE *fp=fopen("seats.dat","rb");
    if(!fp) return 0;
    struct seat s; int count=0;
    while(fread(&s,sizeof(struct seat),1,fp))
        if(s.flight_id==flightId && s.seat_booked==0){ 
            count++;
        }
    fclose(fp);
    return count;
}


// ================= USER FUNCTIONS =================
void RegisterUser(void)
{
    struct User u;
    struct User temp; // Temporary struct for reading the file
    int lastId = 1000;
    int emailExists = 0;

    // STEP 1: Get user inputs FIRST
    // We need the email to compare it against the file
    printf("\nEnter Name: ");
    fgets(u.name, 50, stdin); 
    u.name[strcspn(u.name, "\n")] = 0; // Remove newline

    printf("Enter Email: ");
    scanf("%49s", u.email); // %49s prevents buffer overflow

    printf("Enter Password: ");
    scanf("%49s", u.password);

    // STEP 2: Open file in READ mode to check duplicates AND find the last ID
    // We do both in one loop to be efficient
    FILE *fpRead = fopen("users.dat", "rb");
    if (fpRead)
    {
        while(fread(&temp, sizeof(struct User), 1, fpRead))
        {
            // Check if the email currently in the file matches the input
            if (strcmp(temp.email, u.email) == 0)
            {
                emailExists = 1;
            }
            // Keep track of the highest ID found
            lastId = temp.userId;
        }
        fclose(fpRead);
    }

    // STEP 3: Validation Check
    if (emailExists)
    {
        printf("\n[ERROR] Registration Failed: The email '%s' is already registered.\n", u.email);
        return; // Stop the function here, do not save
    }

    // STEP 4: Finalize and Save
    u.userId = lastId + 1;
    u.cash_balance = 100000.0; 
    generateRecoveryCode(u.recoveryCode);

    FILE *fpAppend = fopen("users.dat", "ab");
    if (!fpAppend)
    {
        printf("File error.\n");
        return;
    }

    fwrite(&u, sizeof(struct User), 1, fpAppend);
    fclose(fpAppend);

    printf("\nREGISTRATION SUCCESSFUL\n");
    printf("SAVE THIS RECOVERY CODE CAREFULLY\n");
    printf("Recovery Code: %s\n", u.recoveryCode);
}

// ================= LOGIN =================
int LoginUser(void)
{
    struct User u;
    char email[50], password[50];
    FILE *fp = fopen("users.dat", "rb");

    if (!fp)
    {
        printf("No users found.\n");
        return 0;
    }

    printf("\nEnter Email: ");
    scanf("%s", email);

    printf("Enter Password: ");
    scanf("%s", password);

    while (fread(&u, sizeof(struct User), 1, fp)) // Check credentials agains file
    {
        if (strcmp(u.email, email) == 0 &&
            strcmp(u.password, password) == 0)
        {
            fclose(fp);
            printf("Login successful! Welcome, %s.\n", u.name);
            return u.userId;  // return actual userId
        }
    }

    fclose(fp);
    printf("Invalid email or password.\n");
    return 0;  // login failed
}


// ================= FORGOT PASSWORD =================
void forgotPassword(void) // Function to reset password using recovery code
{
    struct User u;
    char email[50], code[10], newPassword[50];
    int found = 0;

    FILE *fp = fopen("users.dat", "rb");
    FILE *temp = fopen("temp.dat", "wb");

    if (!fp || !temp)
    {
        printf("File error.\n");
        if (fp) fclose(fp);
        if (temp) fclose(temp);
        return;
    }

    printf("\nEnter Email: ");
    scanf("%s", email);
    getchar(); // clear newline

    printf("Enter Recovery Code: ");
    fgets(code, sizeof(code), stdin);
    code[strcspn(code, "\n")] = 0; // remove newline

    while (fread(&u, sizeof(struct User), 1, fp)) // Iterate through users
    {
        if (strcmp(u.email, email) == 0 &&
            strcmp(u.recoveryCode, code) == 0) // Check logic
        {
            printf("Enter New Password: ");
            scanf("%s", newPassword);
            strcpy(u.password, newPassword); // Update password
            found = 1;
        }
        fwrite(&u, sizeof(struct User), 1, temp); // Write to temp
    }

    fclose(fp);
    fclose(temp);

    remove("users.dat"); // Replace existing file
    rename("temp.dat", "users.dat");

    if (found)
        printf("Password reset successful.\n");
    else
        printf("Invalid email or recovery code.\n");
}


// ================= USER MENU =================
void userMenu(int loggedInUserId)
{
    int choice;
    do{
        printf("\n--- USER MENU ---\n");
        printf("1. View Flights \n");
        printf("2. Book Flight \n");
        printf("3. See My Bookings \n");
        printf("4. Cancel Booking \n");
        printf("5. Logout \n");

        printf("Choose: "); 
        scanf("%d",&choice); 
        getchar();
        
        switch(choice)
        {
            case 1: 
            {
                int sChoice;
                printf("Sort by: \n");
                printf(" 1. Price \n"); 
                printf(" 2. Date \n"); 
                printf(" 3. No Sort: \n"); 

                printf("Choose : ");
                scanf("%d",&sChoice);
                view_all_Flights_sorted(sChoice==1);
                break;
            }
            case 2: 
                bookFlight(loggedInUserId); 
                break;
            case 3: 
                view_my_flight(loggedInUserId); 
                break;
            case 4: 
                del_booking(loggedInUserId); 
                break;
            case 5: 
                return;
            default: 
            printf("Invalid choice\n");
        }
    } while(choice!=5);
}

// ================= SEAT SELECTION =================
int chooseSeat(int flightId)
{
    FILE *fp=fopen("seats.dat","rb+"); // Open seats file for update
    if(!fp)
    { 
        printf("Seats file missing.\n"); 
        return -1; 
    }

    struct seat s;
    printf("Available seats for Flight %d:\n", flightId);
    while(fread(&s,sizeof(struct seat),1,fp)) // Display available seats
    {
        if(s.flight_id==flightId && s.seat_booked==0){
            printf("%d ", s.seat_no);
        }
    }
    printf("\nChoose seat number: ");
    int selected;
    scanf("%d",&selected);

    fseek(fp,0,SEEK_SET); // Reset pointer
    while(fread(&s,sizeof(struct seat),1,fp))
    {
        if(s.flight_id==flightId && s.seat_no==selected) // Find seat
        {
            if(s.seat_booked==0)
            {
                s.seat_booked=1;
                fseek(fp,-sizeof(struct seat),SEEK_CUR);
                fwrite(&s,sizeof(struct seat),1,fp); // Update record
                fclose(fp);
                return selected;
            }
            else
            {
                printf("Seat already booked.\n");
                fclose(fp);
                return -1;
            }
        }
    }
    printf("Invalid seat number.\n");
    fclose(fp);
    return -1;
}


// ================= PAYMENT =================
int payForFlight(int userId, float price, char *method)
{
    FILE *fp=fopen("users.dat","rb+"); // Open users file for update
    if(!fp)
    { 
        printf("User file missing.\n"); 
        return 0; 
    }

    struct User u;
    while(fread(&u,sizeof(struct User),1,fp)) // Find user
    {
        if(u.userId==userId)
        {
            printf("Payment method (Cash/Card): ");
            scanf("%s", method);
            if(strcmp(method, "Cash") == 0 || strcmp(method, "cash") == 0)
            {
                if(u.cash_balance < price) // Check balance
                {
                    printf("Insufficient balance. Your balance: %.2f\n", u.cash_balance);
                    fclose(fp);
                    return 0;
                }
                u.cash_balance -= price; // Deduct amount
                fseek(fp,-sizeof(struct User),SEEK_CUR);
                fwrite(&u,sizeof(struct User),1,fp); // Update user record
                fclose(fp);
                return 1;
            }
            else if(strcmp(method, "Card") == 0 || strcmp(method, "card") == 0)
            {
                printf("Card payment successful.\n");
                fclose(fp);
                return 1;
            }
            else
            {
                printf("Invalid payment method.\n");
                fclose(fp);
                return 0;
            }
        }
    }
    fclose(fp);
    return 0;
}


// ================= BOOK FLIGHT =================
int generateBookingId()
{
    FILE *fp=fopen("bookings.dat","rb");
    int lastId=1000;
    if(fp)
    {
        struct Booking b;
        while(fread(&b,sizeof(struct Booking),1,fp))
            if(b.bookingId>lastId) lastId=b.bookingId;
        fclose(fp);
    }
    return lastId+1;
}

void bookFlight(int loggedInUserId)
{
    int flightId;
    printf("Enter Flight ID to book: ");
    scanf("%d",&flightId);

    FILE *fp = fopen("flights.dat","rb");
    if(!fp)
    { 
        printf("Flight not found.\n"); 
        return; 
    }

    struct Flight f; int found=0;
    while(fread(&f,sizeof(struct Flight),1,fp)) // Verify flight exists
    {
        if(f.flight_id==flightId)
        { 
            found=1; 
            break; 
        }
    }
    fclose(fp);
    if(!found)
    { 
        printf("Flight not found.\n"); 
        return; 
    }
    if(countAvailableSeats(flightId)==0) // Check seat availability
    { 
        printf("No seats available.\n"); 
        return; 
    }

    int seatNo = chooseSeat(flightId);
    if(seatNo == -1){ 
        return;
    }
    char method[10];
    if(!payForFlight(loggedInUserId,f.price,method)) 
    {
        printf("Payment failed.\n");
        // release seat if payment failed
        FILE *seatFile=fopen("seats.dat","rb+");
        struct seat s;
        fseek(seatFile,0,SEEK_SET);
        while(fread(&s,sizeof(struct seat),1,seatFile))
        {
            if(s.flight_id==flightId && s.seat_no==seatNo)
            {
                s.seat_booked=0;
                fseek(seatFile,-sizeof(struct seat),SEEK_CUR);
                fwrite(&s,sizeof(struct seat),1,seatFile);
                break;
            }
        }
        fclose(seatFile);
        return;
    }

    FILE *bookingFile=fopen("bookings.dat","ab"); // Save booking details
    if(!bookingFile)
    { 
        printf("Booking file error.\n");
        // Refund and release seat since booking save failed
        if (strcmp(method, "Cash") == 0) {
            FILE *fpUser = fopen("users.dat", "rb+");
            if (fpUser) {
                struct User u;
                while (fread(&u, sizeof(struct User), 1, fpUser)) {
                    if (u.userId == loggedInUserId) {
                        u.cash_balance += f.price; // Refund
                        fseek(fpUser, -sizeof(struct User), SEEK_CUR);
                        fwrite(&u, sizeof(struct User), 1, fpUser);
                        break;
                    }
                }
                fclose(fpUser);
            }
        }
        // Release seat
        FILE *seatFile = fopen("seats.dat", "rb+");
        if (seatFile) {
            struct seat s;
            while (fread(&s, sizeof(struct seat), 1, seatFile)) {
                if (s.flight_id == flightId && s.seat_no == seatNo) {
                    s.seat_booked = 0;
                    fseek(seatFile, -sizeof(struct seat), SEEK_CUR);
                    fwrite(&s, sizeof(struct seat), 1, seatFile);
                    break;
                }
            }
            fclose(seatFile);
        }
        return;
    }

    struct Booking b;
    b.bookingId = generateBookingId();
    b.userId = loggedInUserId;
    b.flight_id = flightId;
    b.seat_no = seatNo;
    b.status = 1;
    strcpy(b.paymentMethod,method);

    // Attempt to write the booking
    if (fwrite(&b, sizeof(struct Booking), 1, bookingFile) != 1) {
        printf("Failed to save booking. Refunding and releasing seat.\n");
        fclose(bookingFile);
        // Refund and release seat
        if (strcmp(method, "Cash") == 0) {
            FILE *fpUser = fopen("users.dat", "rb+");
            if (fpUser) {
                struct User u;
                while (fread(&u, sizeof(struct User), 1, fpUser)) {
                    if (u.userId == loggedInUserId) {
                        u.cash_balance += f.price; // Refund
                        fseek(fpUser, -sizeof(struct User), SEEK_CUR);
                        fwrite(&u, sizeof(struct User), 1, fpUser);
                        break;
                    }
                }
                fclose(fpUser);
            }
        }
        // Release seat
        FILE *seatFile = fopen("seats.dat", "rb+");
        if (seatFile) {
            struct seat s;
            while (fread(&s, sizeof(struct seat), 1, seatFile)) {
                if (s.flight_id == flightId && s.seat_no == seatNo) {
                    s.seat_booked = 0;
                    fseek(seatFile, -sizeof(struct seat), SEEK_CUR);
                    fwrite(&s, sizeof(struct seat), 1, seatFile);
                    break;
                }
            }
            fclose(seatFile);
        }
        return;
    }

    fclose(bookingFile);
    printf("Booking successful! Seat: %d | Booking ID: %d | Paid by: %s\n", seatNo, b.bookingId, method);
}


// ================= VIEW BOOKINGS =================
void view_my_flight(int loggedInUserId)
{
    FILE *fp = fopen("bookings.dat","rb");
    if(!fp)
    { 
        printf("No bookings found.\n"); 
        return; 
    }

    struct Booking b;
    printf("\nYour Bookings:\n");

    // Print table header
    printf("\n%-9s %-10s %-8s %-9s %-6s\n", "ID", "FlightID", "Seat", "Status", "Payment");
    printf("------------------------------------------------------\n");

    int found = 0;
    while(fread(&b,sizeof(struct Booking),1,fp)) // Iterate bookings
    {
        if(b.userId == loggedInUserId)
        {
            printf("%-10d %-10d %-7d %-9s %-6s\n",
                b.bookingId, b.flight_id, b.seat_no,
                b.status ? "Active" : "Cancelled",
                b.paymentMethod);
            found = 1;
        }
    }

    if(!found){
        printf("No booked flights.\n");
    }
    fclose(fp);
}


// ================= CANCEL BOOKING =================
void del_booking(int loggedInUserId)
{
    int cancelId, found = 0;
    int flightId = -1, cancelledSeat = -1;
    char paymentMethod[10];

    printf("Enter Booking ID to cancel: ");
    scanf("%d", &cancelId);

    FILE *bookingFile = fopen("bookings.dat", "rb");
    FILE *tempFile = fopen("temp_bookings.dat", "wb");

    if (!bookingFile || !tempFile)
    {
        if (bookingFile) fclose(bookingFile);
        if (tempFile) fclose(tempFile);
        printf("File error.\n");
        return;
    }

    struct Booking b;

    while (fread(&b, sizeof(struct Booking), 1, bookingFile))
    {
        if (b.bookingId == cancelId && b.userId == loggedInUserId)
        {
            if (b.status == 0)
            {
                printf("This booking is already cancelled.\n");
                fclose(bookingFile);
                fclose(tempFile);
                remove("temp_bookings.dat");
                return;
            }

            found = 1;
            flightId = b.flight_id;
            cancelledSeat = b.seat_no;
            strcpy(paymentMethod, b.paymentMethod);
            b.status = 0;  // cancel only once
        }

        fwrite(&b, sizeof(struct Booking), 1, tempFile);
    }

    fclose(bookingFile);
    fclose(tempFile);

    if (!found)
    {
        remove("temp_bookings.dat");
        printf("Booking not found.\n");
        return;
    }

    remove("bookings.dat");
    rename("temp_bookings.dat", "bookings.dat");

    /* -------- RELEASE SEAT -------- */
    FILE *seatFile = fopen("seats.dat", "rb+");
    if (seatFile)
    {
        struct seat s;
        while (fread(&s, sizeof(struct seat), 1, seatFile))
        {
            if (s.flight_id == flightId && s.seat_no == cancelledSeat)
            {
                s.seat_booked = 0;
                fseek(seatFile, -sizeof(struct seat), SEEK_CUR);
                fwrite(&s, sizeof(struct seat), 1, seatFile);
                break;
            }
        }
        fclose(seatFile);
    }

    /* -------- REFUND (CASH ONLY) -------- */
    if (strcmp(paymentMethod, "Cash") == 0)
    {
        float flightPrice = 0.0;

        FILE *fpFlight = fopen("flights.dat", "rb");
        if (fpFlight)
        {
            struct Flight f;
            while (fread(&f, sizeof(struct Flight), 1, fpFlight))
            {
                if (f.flight_id == flightId)
                {
                    flightPrice = f.price;
                    break;
                }
            }
            fclose(fpFlight);
        }

        FILE *fpUser = fopen("users.dat", "rb+");
        if (fpUser)
        {
            struct User u;
            while (fread(&u, sizeof(struct User), 1, fpUser))
            {
                if (u.userId == loggedInUserId)
                {
                    u.cash_balance += flightPrice;
                    fseek(fpUser, -sizeof(struct User), SEEK_CUR);
                    fwrite(&u, sizeof(struct User), 1, fpUser);
                    break;
                }
            }
            fclose(fpUser);
        }

        printf("Booking cancelled successfully. Cash refunded.\n");
    }
    else
    {
        printf("Booking cancelled successfully.\n");
    }
}
