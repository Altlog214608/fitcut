import { AdminTool } from '../admin/AdminTool';

// 관리자 API는 Cognito 관리자 그룹 + MFA로 보호한다 (ADR-011). 이 화면 자체는 보호 수단이 아니다.
export function AdminPage() {
  return <AdminTool />;
}
