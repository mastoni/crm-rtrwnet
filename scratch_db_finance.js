const db = require('./db');

async function updateDb() {
    try {
        console.log('Starting DB Update for Finance Module...');

        await db.query(`
            CREATE TABLE IF NOT EXISTS finance_transactions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                type ENUM('pemasukan', 'pengeluaran', 'hutang', 'piutang', 'modal') NOT NULL,
                category VARCHAR(100) NOT NULL,
                description TEXT NOT NULL,
                amount DECIMAL(15, 2) NOT NULL,
                date DATE NOT NULL,
                reference_no VARCHAR(100),
                party_name VARCHAR(150),
                due_date DATE,
                status ENUM('belum_lunas', 'cicilan', 'lunas') DEFAULT 'lunas',
                source VARCHAR(150),
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Checked/Created finance_transactions table.');

        console.log('DB Update complete!');
        process.exit(0);
    } catch (error) {
        console.error('Fatal DB Update Error:', error);
        process.exit(1);
    }
}

updateDb();
