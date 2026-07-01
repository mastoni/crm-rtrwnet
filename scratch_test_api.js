const { RouterOSAPI } = require('node-routeros');
const db = require('./db');

const getMikrotikConn = (s) => {
    return new RouterOSAPI({
        host: s.mikrotik_host,
        user: s.mikrotik_user,
        password: s.mikrotik_password || '',
        port: parseInt(s.mikrotik_port || 8728, 10),
        timeout: 10
    });
};

async function test() {
    try {
        const [rows] = await db.query('SELECT * FROM app_settings WHERE setting_key LIKE "mikrotik%"');
        const s = {};
        rows.forEach(r => { s[r.setting_key] = r.setting_value; });
        
        const conn = getMikrotikConn(s);
        await conn.connect();
        const interfaces = await conn.write('/interface/print');
        conn.close();
        
        console.log(`Total interfaces: ${interfaces.length}`);
        const types = {};
        interfaces.forEach(i => {
            types[i.type] = (types[i.type] || 0) + 1;
        });
        console.log('Interface counts by type:', types);
        
        console.log('Non-pppoe interfaces:');
        const nonPppoe = interfaces.filter(i => !i.type.includes('pppoe') && !i.name.includes('<'));
        console.log(nonPppoe.map(i => ({ name: i.name, type: i.type })));
    } catch (err) {
        console.log('FAILED:', err.message);
    }
    process.exit(0);
}

test();
