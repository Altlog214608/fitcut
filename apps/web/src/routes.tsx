import type { RouteObject } from 'react-router';
import { Layout } from './Layout';
import { AdminPage } from './pages/AdminPage';
import { AudioPage } from './pages/AudioPage';
import { GifPage } from './pages/GifPage';
import { HighlightPage } from './pages/HighlightPage';
import { HomePage } from './pages/HomePage';
import { LinkPage } from './pages/LinkPage';
import { MyJobsPage } from './pages/MyJobsPage';
import { RepeatPage } from './link/RepeatPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PhotoPage } from './pages/PhotoPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { RotatePage } from './pages/RotatePage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'photo', element: <PhotoPage /> },
      { path: 'gif', element: <GifPage /> },
      { path: 'audio', element: <AudioPage /> },
      { path: 'rotate', element: <RotatePage /> },
      { path: 'link', element: <LinkPage /> },
      // 구간 반복 링크 (F15). 짧게 공유할 수 있게 /r/<id>
      { path: 'r/:id', element: <RepeatPage /> },
      { path: 'highlight', element: <HighlightPage /> },
      // 보관에 동의한 작업 (F16). 목록과 삭제 열쇠는 이 브라우저에만 있다
      { path: 'my-jobs', element: <MyJobsPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      // 관리자 API는 Cognito 관리자 그룹 + MFA로 보호한다 (M4). 이 화면 자체는 보호 수단이 아니다.
      { path: 'admin', element: <AdminPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
