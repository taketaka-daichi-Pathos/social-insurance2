import { defineConfig } from 'vite';
export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                // 🏢 ルート直下にあるメイン画面たち
                main: 'index.html',
                manager: 'manager.html',
                companySetup: 'company-setup.html',
                employeeDashboard: 'employee-dashboard.html',
                employee: 'employee.html',
                // 📂 srcフォルダの中にあるタブ用（部品）画面たち
                tabEmployeeList: 'src/tab-employee-list.html',
                tabInsuranceMaster: 'src/tab-insurance-master.html',
                tabLifeEvent: 'src/tab-life-event.html',
                tabSalary: 'src/tab-salary.html',
                tabTask: 'src/tab-task.html'
            }
        }
    }
});
//# sourceMappingURL=vite.config.js.map