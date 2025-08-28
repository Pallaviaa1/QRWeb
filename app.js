const express = require('express');
const { getConnection, sql, refreshDbConnection } = require('./db');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
const port = 6100;
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

app.use(cors());
// Test DB connection at startup
(async () => {
    try {
        const pool = await getConnection();
        console.log('Connected to SQL Server successfully!');
        pool.close(); // Optional: close after testing
    } catch (err) {
        console.error('Connection test failed:', err.message);
    }
})();

// API to call stored procedure
// app.get('/data', async (req, res) => {
//     const { productId, date } = req.query;
//     console.log(productId, date);

//     try {
//         if (!productId || !date) {
//             return res.status(400).json({ error: 'Missing required parameters' });
//         }

//         const pool = await getConnection();
//         const result = await pool.request()
//             .input('productoid', sql.VarChar(24), productId)
//             .input('fecha', sql.VarChar(24), date)
//             .execute('sp_cargaTrazabilidad3');

//         const allRecords = result.recordsets.flat(); // flatten all sets
//         console.log(allRecords);

//         res.json(allRecords);
//     } catch (err) {
//         console.error('Stored procedure error:', err.message);
//         res.status(500).send('Server error');
//     }
// });

app.get('/data', async (req, res) => {
    const { productId, date } = req.query;
    console.log(productId, date);

    try {
        if (!productId || !date) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const pool = await getConnection();

        // 1) Get specification limits
        const limitsResult = await pool.request()
            .input('productoid', sql.VarChar(24), productId)
            .execute('sp_CXPinfo');

        const limits = limitsResult.recordsets.flat(); // upper/lower limits

        // 2) Get actual measurements
        const dataResult = await pool.request()
            .input('productoid', sql.VarChar(24), productId)
            .input('fecha', sql.VarChar(24), date)
            .execute('sp_cargaTrazabilidad3');

        const allRecords = dataResult.recordsets.flat(); // actual production data

        // 3) Combine into one response
        res.status(200).json({
            success: true,
            limits,
            allRecords
        });

    } catch (err) {
        console.error('Stored procedure error:', err.message);
        res.status(500).send('Server error');
    }
});

async function testDbConnection({ server, database, user, password, port }) {
    try {
        const testConfig = {
            user,
            password,
            server,
            database,
            port: port ? parseInt(port) : 1433,
            options: {
                encrypt: false,
                trustServerCertificate: true
            }
        };
        const pool = await sql.connect(testConfig);
        await pool.close(); // close immediately after test
        return true;
    } catch (err) {
        console.error('Credential test failed:', err.message);
        return false;
    }
}


// app.post('/add-credentials', async (req, res) => {
//     const { server, database, user, password, port } = req.body;
//     console.log(server, database, user, port);

//     try {
//         // Validate input
//         if (!server || !database || !user || !password) {
//             return res.status(400).json({ error: 'Missing required parameters' });
//         }

//         const pool = await getConnection();

//         // Insert into DbCredentials table
//         await pool.request()
//             .input('ServerName', sql.NVarChar, server)
//             .input('DatabaseName', sql.NVarChar, database)
//             .input('DbUser', sql.NVarChar, user)
//             .input('DbPassword', sql.NVarChar, password)
//             .input('Port', sql.Int, port ? parseInt(port) : 1433)
//             .query(`
//                 INSERT INTO dbo.DbCredentials(ServerName, DatabaseName, DbUser, DbPassword, Port)
//                 VALUES (@ServerName, @DatabaseName, @DbUser, @DbPassword, @Port)
//             `);

//         // If you want to reconnect immediately using new creds:
//         // await refreshDbConnection();

//         res.status(200).json({
//             success: true,
//             message: 'Database credentials added and connection refreshed.'
//         });

//     } catch (err) {
//         console.error('Error inserting credentials:', err.message);
//         res.status(500).send({error:'Server error', message: err.message});
//     }
// });


app.post('/add-credentials', async (req, res) => {
    const { server, database, user, password, port } = req.body;
    console.log(server, database, user, port);

    try {
        // Validate input
        if (!server || !database || !user || !password) {
            return res.status(400).json({ success: false, error: 'Missing required parameters' });
        }

        // 1) Test if credentials actually work
        const valid = await testDbConnection({ server, database, user, password, port });
        if (!valid) {
            return res.status(400).json({ success: false, error: 'Invalid database credentials' });
        }

        // 2) Get main connection (to your admin DB where credentials table is stored)
        const pool = await getConnection();

        // 3) Check if same credentials already exist
        const existing = await pool.request()
            .input('ServerName', sql.NVarChar, server)
            .input('DatabaseName', sql.NVarChar, database)
            .input('DbUser', sql.NVarChar, user)
            .query(`
        SELECT TOP 1 * FROM dbo.DbCredentials
        WHERE ServerName=@ServerName AND DatabaseName=@DatabaseName AND DbUser=@DbUser
      `);

        if (existing.recordset.length > 0) {
            return res.status(409).json({ error: 'Credentials already exist' });
        }

        // 4) Insert into DbCredentials table
        await pool.request()
            .input('ServerName', sql.NVarChar, server)
            .input('DatabaseName', sql.NVarChar, database)
            .input('DbUser', sql.NVarChar, user)
            .input('DbPassword', sql.NVarChar, password)
            .input('Port', sql.Int, port ? parseInt(port) : 1433)
            .query(`
        INSERT INTO dbo.DbCredentials (ServerName, DatabaseName, DbUser, DbPassword, Port)
        VALUES (@ServerName, @DatabaseName, @DbUser, @DbPassword, @Port)
      `);

        res.status(200).json({
            success: true,
            message: 'Database credentials verified and added successfully.'
        });

    } catch (err) {
        console.error('Error inserting credentials:', err.message);
        res.status(500).send({ error: 'Server error', message: err.message });
    }
});


app.put('/admin/update', async (req, res) => {
    const { adminId, oldPassword, newUsername, newPassword } = req.body;

    try {
        // --- Input validation ---
        if (!adminId) {
            return res.status(400).json({ success: false, error: 'Admin ID is required' });
        }

        if (!oldPassword && newPassword) {
            return res.status(400).json({ success: false, error: 'Old password is required to change password' });
        }

        if (!newUsername && !newPassword) {
            return res.status(400).json({ success: false, error: 'Provide a new username or password to update' });
        }

        const pool = await getConnection();

        // --- Fetch admin record ---
        const result = await pool.request()
            .input('AdminID', sql.Int, adminId)
            .query(`SELECT * FROM dbo.AdminUsers WHERE AdminID = @AdminID`);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, error: 'Admin not found' });
        }

        const admin = result.recordset[0];

        // --- If password update requested, check old password ---
        if (newPassword) {
            const isMatch = await bcrypt.compare(oldPassword, admin.PasswordHash);
            if (!isMatch) {
                return res.status(400).json({ success: false, error: 'Old password is incorrect' });
            }
        }

        // --- Prepare updates ---
        let updatedUsername = admin.Username;
        let updatedPasswordHash = admin.PasswordHash;

        if (newUsername) {
            updatedUsername = newUsername;
        }

        if (newPassword) {
            updatedPasswordHash = await bcrypt.hash(newPassword, 10);
        }

        // --- Perform update ---
        await pool.request()
            .input('AdminID', sql.Int, adminId)
            .input('Username', sql.NVarChar, updatedUsername)
            .input('PasswordHash', sql.NVarChar, updatedPasswordHash)
            .query(`
                UPDATE dbo.AdminUsers 
                SET Username = @Username, PasswordHash = @PasswordHash 
                WHERE AdminID = @AdminID
            `);

        res.status(200).json({ success: true, message: 'Admin credentials updated successfully' });

    } catch (err) {
        console.error('Error updating admin:', err.message);
        res.status(500).json({ success: false, error: 'Server error', message: err.message });
    }
});

app.get('/admin/:id', async (req, res) => {
    const { id } = req.params;

    try {
        if (!id) {
            return res.status(400).json({ success: false, error: 'Admin ID is required' });
        }

        const pool = await getConnection();

        // Fetch admin details except password hash
        const result = await pool.request()
            .input('AdminID', sql.Int, id)
            .query(`
                SELECT AdminID, Username, CreatedAt 
                FROM dbo.AdminUsers 
                WHERE AdminID = @AdminID
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, error: 'Admin not found' });
        }

        const admin = result.recordset[0];
        res.status(200).json({ success: true, admin });

    } catch (err) {
        console.error('Error fetching admin details:', err.message);
        res.status(500).json({ success: false, error: 'Server error', message: err.message });
    }
});

// http://localhost:3000/data?productId=TOR01&date=2025-05-05
// https://sisccltd.com/QRWebApp/data?productId=TOR01&date=2025-05-05

/* localhost:6100/add-credentials
 {
    "server":"127.0.0.1", "database":"FSQC6_CONFIG", "user":"nodejs_user", "password":"nodejs@123", "port":"1433"
    post
} */

/* localhost:6100/admin/update
{
    "adminId":"1",  "newUsername":"", "oldPassword":"admin@123", "newPassword":"admin@123"
    put
}
 */

/* 
localhost:6100/admin/1
get
 */

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
