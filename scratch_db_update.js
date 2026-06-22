const db = require('./db');

async function updateDb() {
    try {
        console.log('Starting DB Update for Reward Points...');

        // 1. Create reward_items table
        await db.query(`
            CREATE TABLE IF NOT EXISTS reward_items (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                points_required INT NOT NULL,
                stock INT DEFAULT 0,
                image_url TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Checked/Created reward_items table.');

        // 2. Create reward_history table
        await db.query(`
            CREATE TABLE IF NOT EXISTS reward_history (
                id INT PRIMARY KEY AUTO_INCREMENT,
                customer_id INT NOT NULL,
                item_id INT,
                points INT NOT NULL,
                type TEXT NOT NULL,
                status TEXT DEFAULT 'approved',
                description TEXT,
                reference_id VARCHAR(50),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES reward_items(id) ON DELETE SET NULL
            )
        `);
        console.log('Checked/Created reward_history table.');

        // 3. Add columns to customers
        const columnsToAdd = [
            { column: 'points', sql: 'ALTER TABLE customers ADD COLUMN points INTEGER DEFAULT 0' },
            { column: 'reward_points', sql: 'ALTER TABLE customers ADD COLUMN reward_points INTEGER DEFAULT 0' },
            { column: 'is_reward_enabled', sql: 'ALTER TABLE customers ADD COLUMN is_reward_enabled BOOLEAN DEFAULT 1' },
            { column: 'last_reward_at', sql: 'ALTER TABLE customers ADD COLUMN last_reward_at DATETIME NULL' }
        ];

        for (const item of columnsToAdd) {
            try {
                const [columns] = await db.query(`SHOW COLUMNS FROM customers LIKE ?`, [item.column]);
                if (columns.length === 0) {
                    await db.query(item.sql);
                    console.log(`Added column ${item.column} to customers table.`);
                } else {
                    console.log(`Column ${item.column} already exists in customers table.`);
                }
            } catch (err) {
                console.error(`Error adding column ${item.column}:`, err.message);
            }
        }

        // 4. Create ping_targets table
        await db.query(`
            CREATE TABLE IF NOT EXISTS ping_targets (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                target VARCHAR(255) NOT NULL,
                status VARCHAR(50) DEFAULT 'unknown',
                latency INT DEFAULT 0,
                loss INT DEFAULT 0,
                last_checked DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Checked/Created ping_targets table.');

        // Seed initial data if table is empty
        const [existingTargets] = await db.query('SELECT COUNT(*) as count FROM ping_targets');
        if (existingTargets[0].count === 0) {
            const initialTargets = [
                ['Core Router', '192.168.1.1'],
                ['Distribution OLT', '192.168.10.2'],
                ['Switch BTS Bukit', '10.10.10.5'],
                ['Google DNS', '8.8.8.8'],
                ['Cloudflare DNS', '1.1.1.1']
            ];
            for (const [name, target] of initialTargets) {
                await db.query('INSERT INTO ping_targets (name, target) VALUES (?, ?)', [name, target]);
            }
            console.log('Seeded initial ping targets.');
        }

        console.log('DB Update complete!');
        process.exit(0);
    } catch (error) {
        console.error('Fatal DB Update Error:', error);
        process.exit(1);
    }
}

updateDb();
