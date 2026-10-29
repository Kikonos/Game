import { NewGame } from './screens/NewGame';
import { Loading } from './screens/Loading';
import { Title } from './screens/Title';
import { Shell } from './shell/Shell';
import { Toasts } from './game/Toasts';
import { RotateHint } from './components/RotateHint';
import { useStore } from './store';

export function App() {
  const s = useStore();
  return (
    <>
      {s.screen === 'loading' && <Loading />}
      {s.screen === 'title' && <Title />}
      {s.screen === 'newgame' && <NewGame />}
      {s.screen === 'game' && s.game && <Shell />}
      <Toasts />
      <RotateHint />
    </>
  );
}
