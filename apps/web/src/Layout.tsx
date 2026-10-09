import { NavLink, Outlet } from 'react-router';

const tools = [
  { to: '/photo', label: '사진' },
  { to: '/gif', label: '움짤' },
  { to: '/audio', label: '음성' },
  { to: '/link', label: '링크 구간' },
  { to: '/highlight', label: '하이라이트' },
];

export function Layout() {
  return (
    <>
      <header>
        <NavLink to="/">FitCut</NavLink>
        <nav aria-label="도구">
          <ul>
            {tools.map((tool) => (
              <li key={tool.to}>
                <NavLink to={tool.to}>{tool.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
