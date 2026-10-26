import { Composition, registerRoot } from 'remotion';
import { RelayaDemo } from './RelayaDemo';

const Root = () => <Composition id="RelayaDemo" component={RelayaDemo} width={1920} height={1080} fps={30} durationInFrames={600} />;
registerRoot(Root);
