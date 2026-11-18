import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import * as Updates from 'expo-updates';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './src/lib/supabase';
import {
  loadInbox,
  loadMessages,
  markConversationRead,
  messagePreview,
  parseGifMessage,
  searchMembers,
  sendGif,
  sendMessage,
  startConversation,
  type NorthworkConversation,
  type NorthworkMessage,
  type NorthworkProfile,
} from './src/lib/chat';

const C = {
  bg: '#08090D',
  panel: '#101219',
  panel2: '#151925',
  panel3: '#1B2130',
  line: '#252C3A',
  lineSoft: '#1B202B',
  text: '#F4F5FA',
  muted: '#8E98AA',
  faint: '#647086',
  blue: '#6DAEFF',
  blueDeep: '#263D62',
  purple: '#A78BFA',
  outgoing: '#202D43',
  incoming: '#151A24',
  green: '#5FD5A0',
  danger: '#FF7C91',
};

const GIPHY_API_KEY = process.env.EXPO_PUBLIC_GIPHY_API_KEY ?? '';
const GIPHY_ATTRIBUTION = 'Powered by GIPHY';

type Screen = 'inbox' | 'chat';
type Profile = NorthworkProfile & { bio?: string | null };
type GifResult = any;

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Something went wrong.');
  if (/network request failed|fetch failed/i.test(message)) return 'Could not reach Northwork. Check your internet connection and try again.';
  if (/row-level security|permission denied|not authorized/i.test(message)) return 'Supabase blocked this action. Your existing Northwork chat permissions need to be checked.';
  if (/northwork_public_profiles|schema cache|column .* does not exist/i.test(message)) return 'The Northwork profile view or username migration may be missing. The app expects the same database setup as the website.';
  return message;
}

function initials(name?: string | null): string {
  const value = String(name || 'N').trim();
  return value.slice(0, 1).toUpperCase() || 'N';
}

function formatTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatListTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? formatTime(value)
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function Avatar({ profile, size = 48 }: { profile: Partial<NorthworkProfile> | null; size?: number }) {
  const name = profile?.display_name || profile?.username || 'Northwork member';
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: Math.max(12, size * 0.28) }]}>
      {profile?.avatar_url ? (
        <ExpoImage source={{ uri: profile.avatar_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
      ) : (
        <Text style={[styles.avatarInitial, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
      )}
    </View>
  );
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <View style={styles.brandWrap}>
      <View style={[styles.brandSquare, small && styles.brandSquareSmall]}>
        <Text style={[styles.brandN, small && styles.brandNSmall]}>N</Text>
      </View>
      <View>
        <Text style={[styles.brandTitle, small && styles.brandTitleSmall]}>NORTHWORK</Text>
        {!small && <Text style={styles.brandSubtitle}>PRIVATE MESSAGES</Text>}
      </View>
    </View>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);

  const submit = async () => {
    if (!supabase) return;
    Keyboard.dismiss();
    setFeedback('');
    if (!email.trim() || !password) {
      setFeedback('Enter your email and password to continue.');
      setFeedbackError(true);
      return;
    }
    if (mode === 'signup' && !displayName.trim()) {
      setFeedback('Add a display name for your Northwork profile.');
      setFeedbackError(true);
      return;
    }
    if (password.length < 8) {
      setFeedback('Your password must contain at least 8 characters.');
      setFeedbackError(true);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } },
        });
        if (error) throw error;
        if (!data.session) {
          setFeedback('Account created. Check your email for the confirmation link, then come back and log in.');
        } else {
          setFeedback('Your Northwork account is ready.');
        }
        setFeedbackError(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (error) {
      setFeedback(friendlyError(error));
      setFeedbackError(true);
    } finally {
      setBusy(false);
    }
  };


  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.authScreen}>
        <View style={styles.authTop}>
          <BrandMark />
          <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.livePillText}>NORTHWORK NETWORK</Text></View>
        </View>
        <View style={styles.authContent}>
          <Text style={styles.eyebrow}>YOUR PEOPLE. ONE PLACE.</Text>
          <Text style={styles.authTitle}>{mode === 'login' ? 'Welcome back.' : 'Join Northwork.'}</Text>
          <Text style={styles.authDescription}>Sign in with the same Northwork account you use on the website. Your existing conversations stay right where they are.</Text>
          {mode === 'signup' && (
            <Field label="DISPLAY NAME" value={displayName} onChangeText={setDisplayName} placeholder="How people see you" autoCapitalize="words" />
          )}
          <Field label="EMAIL ADDRESS" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label="PASSWORD" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoCapitalize="none" />
          {!!feedback && <Text style={[styles.feedback, feedbackError && styles.feedbackError]}>{feedback}</Text>}
          <Pressable disabled={busy} onPress={submit} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color="#10121A" /> : <Text style={styles.primaryButtonText}>{mode === 'login' ? 'Log in' : 'Create account'}  ↗</Text>}
          </Pressable>
          <View style={styles.authSwitchRow}>
            <Text style={styles.mutedText}>{mode === 'login' ? "Don't have a Northwork account?" : 'Already have an account?'}</Text>
            <Pressable onPress={() => { setMode(mode === 'login' ? 'signup' : 'login'); setFeedback(''); }}>
              <Text style={styles.linkText}>{mode === 'login' ? 'Sign up' : 'Log in'}</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.authFooter}>NORTHWORK CHAT  ·  PRIVATE BY DESIGN</Text>
      </View>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder: string;
  secureTextEntry?: boolean; keyboardType?: 'default' | 'email-address'; autoCapitalize?: 'none' | 'words';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={C.faint}
        secureTextEntry={props.secureTextEntry}
        keyboardType={props.keyboardType || 'default'}
        autoCapitalize={props.autoCapitalize || 'none'}
        autoCorrect={false}
        style={styles.fieldInput}
      />
    </View>
  );
}

function InboxScreen(props: {
  profile: Profile; email?: string; conversations: NorthworkConversation[]; loading: boolean; error: string;
  onOpen: (item: NorthworkConversation) => void; onSignOut: () => void;
  query: string; onQuery: (value: string) => void; onSearch: () => void;
  results: NorthworkProfile[]; searching: boolean; onStart: (profile: NorthworkProfile) => void;
}) {
  const { profile, conversations, loading, error, onOpen, query, onQuery, onSearch, results, searching, onStart } = props;
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <BrandMark />
          <Pressable onPress={props.onSignOut} style={styles.accountButton}>
            <Avatar profile={profile} size={36} />
            <Text style={styles.accountButtonText}>Account</Text>
          </Pressable>
        </View>
        <View style={styles.inboxHeading}>
          <View>
            <Text style={styles.eyebrow}>YOUR INBOX</Text>
            <Text style={styles.pageTitle}>Messages</Text>
          </View>
          <View style={styles.countBadge}><Text style={styles.countBadgeText}>{conversations.filter((item) => item.unread).length}</Text></View>
        </View>
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={onQuery}
            onSubmitEditing={onSearch}
            returnKeyType="search"
            placeholder="Find a member by name or @username"
            placeholderTextColor={C.faint}
            autoCapitalize="none"
            style={styles.searchInput}
          />
          <Pressable onPress={onSearch} style={styles.searchButton}><Text style={styles.searchButtonText}>↗</Text></Pressable>
        </View>
        {(searching || results.length > 0 || query.trim().length >= 2) && (
          <View style={styles.searchResultsBlock}>
            <Text style={styles.sectionLabel}>MEMBERS</Text>
            {searching ? <ActivityIndicator color={C.blue} style={{ padding: 18 }} /> : results.length ? results.map((item) => (
              <Pressable key={item.id} onPress={() => onStart(item)} style={styles.memberResult}>
                <Avatar profile={item} size={42} />
                <View style={styles.memberResultCopy}>
                  <Text style={styles.memberName}>{item.display_name || 'Northwork member'}</Text>
                  <Text style={styles.memberUsername}>{item.username ? `@${item.username}` : 'Northwork member'}</Text>
                </View>
                <Text style={styles.messageAction}>MESSAGE</Text>
              </Pressable>
            )) : <Text style={styles.emptyHint}>No matching public members.</Text>}
          </View>
        )}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>DIRECT MESSAGES</Text>
          <Text style={styles.sectionAside}>YOUR CHATS</Text>
        </View>
        {loading ? (
          <View style={styles.centerFill}><ActivityIndicator color={C.blue} /><Text style={styles.emptyHint}>Loading your conversations…</Text></View>
        ) : error ? (
          <View style={styles.noticeCard}><Text style={styles.noticeTitle}>Couldn't load chats</Text><Text style={styles.noticeText}>{error}</Text></View>
        ) : conversations.length === 0 ? (
          <View style={styles.emptyInbox}>
            <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>✉</Text></View>
            <Text style={styles.emptyTitle}>Your inbox is clear.</Text>
            <Text style={styles.emptyHint}>Search for a Northwork member above to start your first conversation. Your website chats will appear here too.</Text>
          </View>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.conversationList}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const preview = item.lastMessage ? messagePreview(item.lastMessage.body) : 'Start the conversation';
              const prefix = item.lastMessage?.sender_id === profile.id ? 'You: ' : '';
              return (
                <Pressable onPress={() => onOpen(item)} style={({ pressed }) => [styles.conversationRow, pressed && styles.rowPressed]}>
                  <Avatar profile={item.peer} size={52} />
                  <View style={styles.conversationCopy}>
                    <View style={styles.conversationTopLine}>
                      <Text style={styles.conversationName} numberOfLines={1}>{item.peer.display_name || 'Northwork member'}</Text>
                      <Text style={styles.conversationTime}>{formatListTime(item.last_message_at || item.created_at)}</Text>
                    </View>
                    <Text style={[styles.conversationPreview, item.unread && styles.conversationPreviewUnread]} numberOfLines={1}>{prefix}{preview}</Text>
                  </View>
                  {item.unread && <View style={styles.unreadDot} />}
                </Pressable>
              );
            }}
          />
        )}
        <View style={styles.bottomLabel}><View style={styles.bottomLine} /><Text style={styles.bottomLabelText}>NORTHWORK  /  PRIVATE MESSAGING</Text></View>
      </View>
    </SafeAreaView>
  );
}

function ChatScreen(props: {
  profile: Profile; conversation: NorthworkConversation; messages: NorthworkMessage[];
  loading: boolean; sending: boolean; draft: string; onDraft: (value: string) => void;
  onBack: () => void; onSend: () => void; onGif: () => void; listRef: React.RefObject<FlatList<NorthworkMessage> | null>;
}) {
  const { profile, conversation, messages, loading, sending, draft, onDraft, onBack, onSend, onGif, listRef } = props;
  const peer = conversation.peer;
  const renderMessage = ({ item }: { item: NorthworkMessage }) => {
    const mine = item.sender_id === profile.id;
    const gif = parseGifMessage(item.body);
    return (
      <View style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowTheirs]}>
        {!mine && <Avatar profile={peer} size={30} />}
        <View style={[styles.messageBubble, mine ? styles.messageBubbleMine : styles.messageBubbleTheirs, gif && styles.gifBubble]}>
          {gif ? (
            <View>
              <Pressable onPress={() => Alert.alert('GIPHY', gif.title || 'Animated GIF')}>
                <ExpoImage source={{ uri: gif.url }} style={styles.messageGif} contentFit="contain" autoplay cachePolicy="memory-disk" />
              </Pressable>
              <Text style={styles.gifCredit}>{gif.creator ? `GIF by @${gif.creator} · ` : 'GIF · '}{GIPHY_ATTRIBUTION}</Text>
            </View>
          ) : (
            <Text style={styles.messageBody}>{item.body}</Text>
          )}
          <Text style={[styles.messageTime, mine && styles.messageTimeMine]}>{formatTime(item.created_at)}</Text>
        </View>
        {mine && <Avatar profile={profile} size={30} />}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        <View style={styles.chatHeader}>
          <Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backButtonText}>‹</Text></Pressable>
          <Avatar profile={peer} size={42} />
          <View style={styles.chatHeaderCopy}>
            <Text style={styles.chatPeerName} numberOfLines={1}>{peer.display_name || 'Northwork member'}</Text>
            <Text style={styles.chatPeerUsername}>{peer.username ? `@${peer.username}` : 'Northwork member'}</Text>
          </View>
          <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.livePillText}>LIVE</Text></View>
        </View>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyThread}>
              {loading ? <ActivityIndicator color={C.blue} /> : <Text style={styles.emptyHint}>This is the beginning of your conversation. Say hello.</Text>}
            </View>
          }
        />
        <View style={styles.composerWrap}>
          <View style={styles.composerRow}>
            <Pressable onPress={onGif} style={styles.gifButton}><Text style={styles.gifButtonText}>GIF</Text></Pressable>
            <TextInput
              value={draft}
              onChangeText={onDraft}
              placeholder="Write a message…"
              placeholderTextColor={C.faint}
              multiline
              maxLength={3000}
              style={styles.composerInput}
              textAlignVertical="center"
              blurOnSubmit={false}
            />
            <Pressable disabled={sending || !draft.trim()} onPress={onSend} style={[styles.sendButton, (!draft.trim() || sending) && styles.disabled]}>
              {sending ? <ActivityIndicator color="#0B101A" size="small" /> : <Text style={styles.sendButtonText}>↑</Text>}
            </Pressable>
          </View>
          <Text style={styles.composerHint}>ENTER TO SEND  ·  KEEP IT KIND</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function GifPicker(props: {
  visible: boolean; onClose: () => void; onSelect: (gif: GifResult) => void; sending: boolean;
}) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchSequence = useRef(0);

  const load = useCallback(async (term = '') => {
    if (!GIPHY_API_KEY || GIPHY_API_KEY.includes('PASTE_')) {
      setError('Add your GIPHY Web API key to the app .env file to enable GIF search.');
      return;
    }
    const sequence = ++searchSequence.current;
    setLoading(true);
    setError('');
    try {
      const endpoint = term.trim() ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending';
      const url = new URL(endpoint);
      url.searchParams.set('api_key', GIPHY_API_KEY);
      url.searchParams.set('limit', '24');
      url.searchParams.set('rating', 'g');
      url.searchParams.set('bundle', 'messaging_non_clips');
      if (term.trim()) {
        url.searchParams.set('q', term.trim().slice(0, 50));
        url.searchParams.set('lang', 'en');
      }
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(response.status === 403 ? 'GIPHY rejected this API key. Check that it is active.' : `GIPHY request failed (${response.status}).`);
      const result = await response.json();
      if (sequence !== searchSequence.current) return;
      const items = Array.isArray(result.data) ? result.data.filter((gif: any) => gif.images?.fixed_width_small?.url && gif.images?.original?.url) : [];
      setGifs(items);
      if (!items.length) setError('No GIFs found. Try another search.');
    } catch (loadError) {
      if (sequence === searchSequence.current) setError(friendlyError(loadError));
    } finally {
      if (sequence === searchSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (props.visible) {
      setQuery('');
      setGifs([]);
      void load('');
    }
  }, [props.visible, load]);

  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.gifModal}>
          <View style={styles.modalHandle} />
          <View style={styles.modalTitleRow}>
            <View><Text style={styles.modalTitle}>Choose a GIF</Text><Text style={styles.modalSubtitle}>{GIPHY_ATTRIBUTION}</Text></View>
            <Pressable onPress={props.onClose} style={styles.modalClose}><Text style={styles.modalCloseText}>×</Text></Pressable>
          </View>
          <View style={styles.gifSearchRow}>
            <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => load(query)} returnKeyType="search" placeholder="Search GIFs" placeholderTextColor={C.faint} style={styles.gifSearchInput} />
            <Pressable onPress={() => load(query)} style={styles.gifSearchButton}><Text style={styles.gifSearchButtonText}>Search</Text></Pressable>
          </View>
          {loading ? <ActivityIndicator color={C.blue} style={{ marginTop: 28 }} /> : null}
          {!!error && <Text style={styles.gifError}>{error}</Text>}
          <FlatList
            data={gifs}
            keyExtractor={(item) => String(item.id)}
            numColumns={2}
            contentContainerStyle={styles.gifGrid}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable disabled={props.sending} onPress={() => props.onSelect(item)} style={styles.gifTile}>
                <ExpoImage source={{ uri: item.images.fixed_width_small.url }} style={styles.gifTileImage} contentFit="cover" autoplay cachePolicy="memory-disk" />
                <Text style={styles.gifTileTitle} numberOfLines={1}>{item.title || 'Send GIF'}</Text>
              </Pressable>
            )}
          />
          <Text style={styles.gifAttribution}>GIFs supplied by GIPHY</Text>
        </View>
      </View>
    </Modal>
  );
}

function ProfileModal({ visible, profile, email, onClose, onSignOut }: {
  visible: boolean; profile: Profile; email?: string; onClose: () => void; onSignOut: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdropCenter} onPress={onClose}>
        <Pressable style={styles.profileModal} onPress={() => {}}>
          <View style={styles.profileModalTop}><Text style={styles.modalTitle}>Your account</Text><Pressable onPress={onClose}><Text style={styles.modalCloseText}>×</Text></Pressable></View>
          <Avatar profile={profile} size={76} />
          <Text style={styles.profileModalName}>{profile.display_name || 'Northwork member'}</Text>
          <Text style={styles.profileModalUsername}>{profile.username ? `@${profile.username}` : email || ''}</Text>
          <View style={styles.profileModalDivider} />
          <Pressable onPress={onSignOut} style={styles.signOutButton}><Text style={styles.signOutText}>Log out of Northwork</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}


function NorthworkUpdatePrompt() {
  const [available, setAvailable] = useState(false);
  const [installing, setInstalling] = useState(false);
  const checkInFlight = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled || checkInFlight.current) return;
    checkInFlight.current = true;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) setAvailable(true);
    } catch (error) {
      console.warn('Northwork update check failed:', error);
    } finally {
      checkInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void checkForUpdate();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkForUpdate();
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void checkForUpdate();
    }, 15 * 60 * 1000);
    return () => {
      appState.remove();
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  const installUpdate = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      const result = await Updates.fetchUpdateAsync();
      if (result.isNew) {
        await Updates.reloadAsync();
        return;
      }
      setAvailable(false);
    } catch (error) {
      console.warn('Northwork update download failed:', error);
      Alert.alert('Update could not be installed', 'Please check your internet connection and try again.');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal visible={available} transparent animationType="fade" onRequestClose={() => setAvailable(false)}>
      <View style={styles.updateBackdrop}>
        <View style={styles.updateCard}>
          <View style={styles.updateIcon}><Text style={styles.updateIconText}>N</Text></View>
          <Text style={styles.updateEyebrow}>NORTHWORK CHAT</Text>
          <Text style={styles.updateTitle}>A new update is ready.</Text>
          <Text style={styles.updateDescription}>
            We've made improvements to Northwork Chat. Install the latest update to get the newest experience.
          </Text>
          <Pressable disabled={installing} onPress={installUpdate} style={({ pressed }) => [styles.updatePrimary, pressed && styles.pressed, installing && styles.disabled]}>
            {installing ? <ActivityIndicator color="#0B111C" /> : <Text style={styles.updatePrimaryText}>Install update  ↗</Text>}
          </Pressable>
          <Pressable disabled={installing} onPress={() => setAvailable(false)} style={styles.updateLater}>
            <Text style={styles.updateLaterText}>Later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [screen, setScreen] = useState<Screen>('inbox');
  const [conversations, setConversations] = useState<NorthworkConversation[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [inboxError, setInboxError] = useState('');
  const [activeConversation, setActiveConversation] = useState<NorthworkConversation | null>(null);
  const activeConversationRef = useRef<NorthworkConversation | null>(null);
  const screenRef = useRef<Screen>('inbox');
  const [messages, setMessages] = useState<NorthworkMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NorthworkProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const messageListRef = useRef<FlatList<NorthworkMessage> | null>(null);

  const user = session?.user ?? null;
  const userId = user?.id ?? '';

  useEffect(() => { screenRef.current = screen; }, [screen]);

  useEffect(() => {
    if (!supabase) {
      setBooting(false);
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.warn('Northwork session restore:', error.message);
      if (mounted) {
        setSession(data.session);
        setBooting(false);
      }
    }).catch((error) => {
      console.warn('Northwork session restore failed:', error);
      if (mounted) setBooting(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user) {
      setProfile(null);
      setConversations([]);
      setActiveConversation(null);
      activeConversationRef.current = null;
      setMessages([]);
      setScreen('inbox');
      return;
    }
    let alive = true;
    setProfileLoading(true);
    supabase.from('profiles')
      .select('id,display_name,username,avatar_url,bio')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw error;
        if (!alive) return;
        setProfile(data ?? {
          id: user.id,
          display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || 'Northwork member',
          username: user.user_metadata?.username || null,
          avatar_url: user.user_metadata?.avatar_url || null,
        });
      })
      .catch((error) => {
        console.warn('Northwork profile unavailable:', error);
        if (alive) setProfile({
          id: user.id,
          display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || 'Northwork member',
          username: user.user_metadata?.username || null,
          avatar_url: user.user_metadata?.avatar_url || null,
        });
      })
      .finally(() => { if (alive) setProfileLoading(false); });
    return () => { alive = false; };
  }, [userId]);

  const refreshInbox = useCallback(async (): Promise<NorthworkConversation[]> => {
    if (!supabase || !userId) return [];
    setLoadingInbox(true);
    setInboxError('');
    try {
      const result = await loadInbox(supabase, userId);
      setConversations(result);
      return result;
    } catch (error) {
      const message = friendlyError(error);
      setInboxError(message);
      throw error;
    } finally {
      setLoadingInbox(false);
    }
  }, [userId]);

  useEffect(() => {
    if (profile && userId) void refreshInbox().catch((error) => console.warn('Inbox load:', error));
  }, [profile?.id, userId, refreshInbox]);

  useEffect(() => {
    if (!supabase || !userId) return;
    let mounted = true;
    const channel = supabase.channel(`northwork-chat-mobile-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'northwork_messages' }, (payload) => {
        if (!mounted) return;
        const incoming = payload.new as NorthworkMessage;
        if (!incoming?.id || !incoming?.conversation_id) return;
        if (screenRef.current === 'chat' && AppState.currentState === 'active' && activeConversationRef.current?.id === incoming.conversation_id) {
          setMessages((current) => current.some((item) => item.id === incoming.id) ? current : [...current, incoming]);
          void markConversationRead(supabase, incoming.conversation_id, userId).catch((error) => console.warn('Read marker:', error));
        }
        void refreshInbox().catch((error) => console.warn('Realtime inbox refresh:', error));
      })
      .subscribe();
    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [userId, refreshInbox]);

  const openConversation = async (item: NorthworkConversation) => {
    if (!supabase || !userId) return;
    activeConversationRef.current = item;
    setActiveConversation(item);
    screenRef.current = 'chat';
    setScreen('chat');
    setMessages([]);
    setDraft('');
    setLoadingMessages(true);
    try {
      const data = await loadMessages(supabase, item.id);
      if (activeConversationRef.current?.id !== item.id) return;
      setMessages(data);
      await markConversationRead(supabase, item.id, userId);
      await refreshInbox();
    } catch (error) {
      Alert.alert('Could not open chat', friendlyError(error));
    } finally {
      setLoadingMessages(false);
    }
  };

  const doSearch = async () => {
    if (!supabase || !userId) return;
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      setSearchResults(await searchMembers(supabase, userId, searchQuery));
    } catch (error) {
      Alert.alert('Member search failed', friendlyError(error));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const startNewConversation = async (peer: NorthworkProfile) => {
    if (!supabase || !userId) return;
    Keyboard.dismiss();
    try {
      const conversationId = await startConversation(supabase, peer.id);
      setSearchResults([]);
      setSearchQuery('');
      const refreshed = await refreshInbox();
      const existing = refreshed.find((item) => item.id === conversationId);
      const item: NorthworkConversation = existing ?? {
        id: conversationId,
        member_one: userId,
        member_two: peer.id,
        last_message_at: null,
        created_at: new Date().toISOString(),
        peer,
        lastMessage: null,
        unread: false,
      };
      await openConversation(item);
    } catch (error) {
      Alert.alert('Could not start chat', friendlyError(error));
    }
  };

  const doSend = async () => {
    if (!supabase || !userId || !activeConversation || !draft.trim() || sending) return;
    const text = draft;
    setSending(true);
    setDraft('');
    try {
      const sent = await sendMessage(supabase, activeConversation.id, userId, text);
      setMessages((current) => current.some((item) => item.id === sent.id) ? current : [...current, sent]);
      await markConversationRead(supabase, activeConversation.id, userId);
      await refreshInbox();
    } catch (error) {
      setDraft(text);
      Alert.alert('Message not sent', friendlyError(error));
    } finally {
      setSending(false);
    }
  };

  const doSendGif = async (gif: GifResult) => {
    if (!supabase || !userId || !activeConversation || sending) return;
    setSending(true);
    try {
      const sent = await sendGif(supabase, activeConversation.id, userId, gif);
      setMessages((current) => current.some((item) => item.id === sent.id) ? current : [...current, sent]);
      setGifPickerVisible(false);
      await markConversationRead(supabase, activeConversation.id, userId);
      await refreshInbox();
    } catch (error) {
      Alert.alert('GIF not sent', friendlyError(error));
    } finally {
      setSending(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    setProfileVisible(false);
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Could not log out', friendlyError(error));
  };

  if (!isSupabaseConfigured || !supabase) {
    return (
      <SafeAreaProvider><SafeAreaView style={styles.safe}>
        <View style={styles.configScreen}>
          <BrandMark />
          <Text style={styles.pageTitle}>Connect Northwork.</Text>
          <Text style={styles.authDescription}>Open the app folder, copy .env.example to .env, then add your existing Supabase publishable key. Never paste a secret or service_role key here.</Text>
        </View>
      </SafeAreaView><NorthworkUpdatePrompt /></SafeAreaProvider>
    );
  }

  if (booting || (user && profileLoading)) {
    return <SafeAreaProvider><SafeAreaView style={styles.safe}><View style={styles.centerFill}><ActivityIndicator color={C.blue} size="large" /><Text style={styles.emptyHint}>Connecting to Northwork…</Text></View></SafeAreaView><NorthworkUpdatePrompt /></SafeAreaProvider>;
  }

  if (!session || !profile) {
    return <SafeAreaProvider><StatusBar barStyle="light-content" backgroundColor={C.bg} /><AuthScreen /><NorthworkUpdatePrompt /></SafeAreaProvider>;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      {screen === 'inbox' ? (
        <InboxScreen
          profile={profile}
          email={user?.email}
          conversations={conversations}
          loading={loadingInbox}
          error={inboxError}
          onOpen={openConversation}
          onSignOut={() => setProfileVisible(true)}
          query={searchQuery}
          onQuery={setSearchQuery}
          onSearch={doSearch}
          results={searchResults}
          searching={searching}
          onStart={startNewConversation}
        />
      ) : activeConversation ? (
        <ChatScreen
          profile={profile}
          conversation={activeConversation}
          messages={messages}
          loading={loadingMessages}
          sending={sending}
          draft={draft}
          onDraft={setDraft}
          onBack={() => { screenRef.current = 'inbox'; setScreen('inbox'); activeConversationRef.current = null; setActiveConversation(null); void refreshInbox(); }}
          onSend={doSend}
          onGif={() => setGifPickerVisible(true)}
          listRef={messageListRef}
        />
      ) : (
        <InboxScreen profile={profile} email={user?.email} conversations={conversations} loading={loadingInbox} error={inboxError} onOpen={openConversation} onSignOut={() => setProfileVisible(true)} query={searchQuery} onQuery={setSearchQuery} onSearch={doSearch} results={searchResults} searching={searching} onStart={startNewConversation} />
      )}
      <GifPicker visible={gifPickerVisible} onClose={() => setGifPickerVisible(false)} onSelect={doSendGif} sending={sending} />
      <ProfileModal visible={profileVisible} profile={profile} email={user?.email} onClose={() => setProfileVisible(false)} onSignOut={signOut} />
      <NorthworkUpdatePrompt />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  screen: { flex: 1, backgroundColor: C.bg },
  authScreen: { flex: 1, paddingHorizontal: 25, backgroundColor: C.bg },
  authTop: { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandSquare: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: '#4B5F85', backgroundColor: '#172235', alignItems: 'center', justifyContent: 'center' },
  brandSquareSmall: { width: 25, height: 25, borderRadius: 7 },
  brandN: { color: '#D9D5FF', fontSize: 20, fontWeight: '900' },
  brandNSmall: { fontSize: 14 },
  brandTitle: { color: C.text, fontSize: 12, letterSpacing: 2.1, fontWeight: '900' },
  brandTitleSmall: { fontSize: 10, letterSpacing: 1.6 },
  brandSubtitle: { marginTop: 3, fontSize: 8, color: C.faint, letterSpacing: 1.6, fontWeight: '700' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 7, borderWidth: 1, borderColor: '#284236', backgroundColor: '#111D1A', borderRadius: 99 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  livePillText: { color: '#9DD9BC', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  authContent: { width: '100%', maxWidth: 460, alignSelf: 'center', marginTop: 46 },
  eyebrow: { color: C.blue, fontSize: 9, fontWeight: '900', letterSpacing: 2.2, marginBottom: 10 },
  authTitle: { color: C.text, fontSize: 36, lineHeight: 42, fontWeight: '800', letterSpacing: -1.3 },
  authDescription: { color: C.muted, fontSize: 13, lineHeight: 21, marginTop: 12, marginBottom: 27 },
  fieldWrap: { marginBottom: 16 },
  fieldLabel: { color: '#AAB4C5', fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },
  fieldInput: { height: 52, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, color: C.text, fontSize: 14, paddingHorizontal: 15 },
  feedback: { color: C.green, fontSize: 12, lineHeight: 18, marginBottom: 13 },
  feedbackError: { color: C.danger },
  primaryButton: { height: 52, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  primaryButtonText: { color: '#0B111C', fontSize: 13, fontWeight: '900', letterSpacing: .2 },
  pressed: { opacity: .78, transform: [{ scale: .99 }] },
  disabled: { opacity: .5 },
  authSwitchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, marginTop: 22 },
  mutedText: { color: C.muted, fontSize: 11 },
  linkText: { color: C.blue, fontSize: 11, fontWeight: '800' },
  authFooter: { color: '#596275', fontSize: 8, letterSpacing: 1.7, fontWeight: '800', marginTop: 'auto', paddingBottom: 22, textAlign: 'center' },
  configScreen: { flex: 1, backgroundColor: C.bg, alignItems: 'flex-start', justifyContent: 'center', padding: 28, gap: 18 },
  topBar: { minHeight: 68, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: C.lineSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  accountButton: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5, paddingLeft: 5, paddingRight: 11, borderRadius: 13, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line },
  accountButtonText: { color: C.muted, fontSize: 10, fontWeight: '700' },
  inboxHeading: { paddingHorizontal: 22, paddingTop: 25, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageTitle: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -.8 },
  countBadge: { width: 28, height: 28, borderRadius: 9, borderWidth: 1, borderColor: '#3B4C68', alignItems: 'center', justifyContent: 'center', backgroundColor: '#162238' },
  countBadgeText: { color: C.blue, fontSize: 11, fontWeight: '800' },
  searchRow: { marginHorizontal: 18, height: 48, flexDirection: 'row', borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: 'hidden', backgroundColor: C.panel },
  searchInput: { flex: 1, color: C.text, paddingHorizontal: 14, fontSize: 12 },
  searchButton: { width: 52, borderLeftWidth: 1, borderLeftColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel2 },
  searchButtonText: { color: C.blue, fontSize: 19, fontWeight: '700' },
  searchResultsBlock: { marginTop: 14, marginHorizontal: 18, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 12, backgroundColor: C.panel },
  memberResult: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.lineSoft },
  memberResultCopy: { flex: 1 },
  memberName: { color: C.text, fontSize: 12, fontWeight: '800' },
  memberUsername: { color: C.muted, fontSize: 10, marginTop: 4 },
  messageAction: { color: C.blue, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  sectionHeader: { paddingHorizontal: 22, paddingTop: 26, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { color: '#9BA7BB', fontSize: 8, letterSpacing: 1.5, fontWeight: '900' },
  sectionAside: { color: C.faint, fontSize: 8, letterSpacing: 1.3, fontWeight: '800' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 13 },
  emptyInbox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 45 },
  emptyIcon: { height: 58, width: 58, borderRadius: 18, borderWidth: 1, borderColor: '#354767', backgroundColor: '#142034', alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  emptyIconText: { color: C.blue, fontSize: 25 },
  emptyTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginBottom: 7 },
  emptyHint: { color: C.muted, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  noticeCard: { margin: 20, padding: 18, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 13, gap: 7 },
  noticeTitle: { color: C.text, fontWeight: '800', fontSize: 13 },
  noticeText: { color: C.muted, fontSize: 11, lineHeight: 18 },
  conversationList: { paddingHorizontal: 12, paddingBottom: 22 },
  conversationRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.lineSoft, gap: 12, borderRadius: 10 },
  rowPressed: { backgroundColor: C.panel2 },
  avatar: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#202A3B', borderWidth: 1, borderColor: '#405272' },
  avatarInitial: { color: '#DAD7FF', fontWeight: '900' },
  conversationCopy: { flex: 1, minWidth: 0 },
  conversationTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  conversationName: { color: C.text, fontSize: 13, fontWeight: '800', flex: 1 },
  conversationTime: { color: C.faint, fontSize: 9 },
  conversationPreview: { marginTop: 5, color: C.muted, fontSize: 11 },
  conversationPreviewUnread: { color: '#DCE7F8', fontWeight: '700' },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.blue, marginLeft: 4 },
  bottomLabel: { paddingHorizontal: 22, paddingVertical: 13, borderTopWidth: 1, borderTopColor: C.lineSoft, flexDirection: 'row', alignItems: 'center', gap: 9 },
  bottomLine: { height: 5, width: 5, backgroundColor: C.purple, borderRadius: 2 },
  bottomLabelText: { color: C.faint, fontSize: 8, letterSpacing: 1.4, fontWeight: '800' },
  chatHeader: { minHeight: 72, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: C.panel },
  backButton: { height: 38, width: 34, alignItems: 'center', justifyContent: 'center' },
  backButtonText: { color: C.blue, fontSize: 34, lineHeight: 36 },
  chatHeaderCopy: { flex: 1, minWidth: 0 },
  chatPeerName: { color: C.text, fontSize: 13, fontWeight: '800' },
  chatPeerUsername: { color: C.muted, fontSize: 10, marginTop: 3 },
  messageList: { paddingHorizontal: 13, paddingTop: 20, paddingBottom: 22, flexGrow: 1, justifyContent: 'flex-end' },
  messageRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 13 },
  messageRowMine: { justifyContent: 'flex-end' },
  messageRowTheirs: { justifyContent: 'flex-start' },
  messageBubble: { maxWidth: '78%', paddingHorizontal: 13, paddingTop: 11, paddingBottom: 8, borderRadius: 15, borderWidth: 1, borderColor: C.line },
  messageBubbleMine: { backgroundColor: C.outgoing, borderColor: '#385277', borderBottomRightRadius: 5 },
  messageBubbleTheirs: { backgroundColor: C.incoming, borderColor: '#2A303C', borderBottomLeftRadius: 5 },
  gifBubble: { padding: 7, maxWidth: '76%' },
  messageBody: { color: C.text, fontSize: 13, lineHeight: 19 },
  messageTime: { color: C.faint, fontSize: 8, textAlign: 'right', marginTop: 6 },
  messageTimeMine: { color: '#91B3E0' },
  messageGif: { width: 215, height: 165, borderRadius: 9, backgroundColor: '#0A0C12' },
  gifCredit: { color: C.muted, fontSize: 8, marginTop: 5, marginBottom: 1 },
  emptyThread: { flex: 1, minHeight: 170, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36 },
  composerWrap: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.panel },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  gifButton: { width: 44, height: 45, borderRadius: 10, borderWidth: 1, borderColor: '#445A7C', backgroundColor: '#18243A', alignItems: 'center', justifyContent: 'center' },
  gifButtonText: { color: C.blue, fontSize: 10, fontWeight: '900', letterSpacing: .5 },
  composerInput: { flex: 1, minHeight: 45, maxHeight: 116, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, color: C.text, fontSize: 13 },
  sendButton: { width: 45, height: 45, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blue },
  sendButtonText: { color: '#0B111C', fontSize: 22, fontWeight: '900' },
  composerHint: { color: C.faint, fontSize: 7, letterSpacing: 1.1, fontWeight: '700', marginTop: 9, marginLeft: 54 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.72)', justifyContent: 'flex-end' },
  gifModal: { height: '82%', backgroundColor: C.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 17, paddingTop: 10, paddingBottom: 10, borderWidth: 1, borderColor: C.line },
  modalHandle: { width: 40, height: 4, borderRadius: 4, backgroundColor: '#4A5261', alignSelf: 'center', marginBottom: 18 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 },
  modalTitle: { color: C.text, fontSize: 18, fontWeight: '800' },
  modalSubtitle: { color: C.faint, fontSize: 9, marginTop: 4 },
  modalClose: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.panel3, alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: C.muted, fontSize: 25, lineHeight: 28 },
  gifSearchRow: { height: 46, flexDirection: 'row', backgroundColor: C.bg, borderRadius: 11, borderWidth: 1, borderColor: C.line, overflow: 'hidden', marginBottom: 14 },
  gifSearchInput: { flex: 1, color: C.text, paddingHorizontal: 12, fontSize: 12 },
  gifSearchButton: { paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blue },
  gifSearchButtonText: { color: '#0B111C', fontSize: 10, fontWeight: '900' },
  gifError: { color: C.danger, fontSize: 11, lineHeight: 17, marginVertical: 10 },
  gifGrid: { paddingBottom: 16 },
  gifTile: { flex: 1, margin: 4, padding: 5, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2 },
  gifTileImage: { width: '100%', height: 112, borderRadius: 7, backgroundColor: C.bg },
  gifTileTitle: { color: C.muted, fontSize: 8, marginTop: 5 },
  gifAttribution: { color: C.faint, textAlign: 'center', fontSize: 8, paddingVertical: 5 },
  modalBackdropCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  profileModal: { width: '100%', maxWidth: 350, padding: 22, borderRadius: 18, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, alignItems: 'center', gap: 10 },
  profileModalTop: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  profileModalName: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 3 },
  profileModalUsername: { color: C.muted, fontSize: 11 },
  profileModalDivider: { height: 1, width: '100%', backgroundColor: C.line, marginVertical: 10 },
  signOutButton: { width: '100%', borderWidth: 1, borderColor: '#633A4B', backgroundColor: '#271720', borderRadius: 10, alignItems: 'center', paddingVertical: 13 },
  signOutText: { color: '#FF9DAE', fontWeight: '800', fontSize: 12 },
  updateBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.78)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  updateCard: { width: '100%', maxWidth: 360, padding: 24, borderRadius: 20, backgroundColor: C.panel, borderWidth: 1, borderColor: '#35445D', alignItems: 'center' },
  updateIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#17263C', borderWidth: 1, borderColor: '#425C82', alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  updateIconText: { color: '#D9D5FF', fontSize: 25, fontWeight: '900' },
  updateEyebrow: { color: C.blue, fontSize: 8, fontWeight: '900', letterSpacing: 2, marginBottom: 9 },
  updateTitle: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: -.5, textAlign: 'center' },
  updateDescription: { color: C.muted, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 10, marginBottom: 20 },
  updatePrimary: { minHeight: 48, width: '100%', borderRadius: 11, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  updatePrimaryText: { color: '#0B111C', fontSize: 12, fontWeight: '900' },
  updateLater: { paddingVertical: 13, paddingHorizontal: 20, marginTop: 3 },
  updateLaterText: { color: C.muted, fontSize: 11, fontWeight: '700' },
});
